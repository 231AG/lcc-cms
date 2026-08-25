import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { idempotencyKey } from "@/lib/db/schema";
import { ValidationError } from "@/lib/errors";

function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export interface IdempotentRunOptions<T> {
  /** Client-generated key, unique per user intent (DER-13). */
  key: string;
  operation: string;
  actorUserId?: string | null;
  /** Hashed to detect a key reused with a different request body. */
  requestPayload: unknown;
  /** The actual mutation. Runs inside a single database transaction. */
  run: (tx: Tx) => Promise<T>;
}

/**
 * Implements the standard mutation shape's idempotency step (plan Section
 * 21.2, steps 3 and 5; DER-13). A repeated key with the SAME payload
 * short-circuits and returns the stored result without re-running `run`. A
 * repeated key with a DIFFERENT payload is a validation error, not a silent
 * replay -- the plan is explicit that this must be "an error, not a replay".
 *
 * This check-then-act sequence has a narrow race window under true
 * concurrent replay of the same key, which is why the plan treats unique
 * constraints as the last line of defence, not the only one (Section
 * 21.5) -- domain-level uniqueness (e.g. one grade per registration) is
 * what actually prevents a duplicated effect if this race is ever hit.
 */
export async function runIdempotent<T>(
  opts: IdempotentRunOptions<T>,
): Promise<T> {
  const requestHash = hashRequest(opts.requestPayload);

  const existing = await db.query.idempotencyKey.findFirst({
    where: eq(idempotencyKey.key, opts.key),
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ValidationError(
        `Idempotency key "${opts.key}" was already used for a different request.`,
      );
    }
    return existing.result as T;
  }

  const result = await db.transaction((tx) => opts.run(tx));

  await db
    .insert(idempotencyKey)
    .values({
      key: opts.key,
      actorUserId: opts.actorUserId ?? null,
      operation: opts.operation,
      requestHash,
      result: result as unknown as object,
    })
    .onConflictDoNothing();

  return result;
}
