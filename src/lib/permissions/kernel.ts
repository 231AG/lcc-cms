import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { permission } from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/errors";

export type Role = "STUDENT" | "ADMIN" | "SUPER_ADMIN";

export interface Actor {
  userId: string;
  role: Role;
}

/**
 * The single server-side permission gate (plan Section 11). Explicit
 * allow-list per (role, action) pair, read from the `app.permission` table
 * -- there is no role hierarchy and no `role_level >= N` shortcut anywhere
 * in this codebase; that shape is a hard constraint the plan calls out by
 * name (Section 11.1) because Super Admin is deliberately NOT a superset of
 * Admin here.
 *
 * Deny by default: a missing row is refused, exactly like an explicit
 * `allowed = false` row (Section 11.4).
 */
export async function assertCan(actor: Actor, action: string): Promise<void> {
  const row = await db.query.permission.findFirst({
    where: and(eq(permission.role, actor.role), eq(permission.action, action)),
  });

  if (!row || !row.allowed) {
    throw new ForbiddenError(`Not available to your role: ${action}`);
  }
}

/** Non-throwing form, for deciding what to render -- never for authorizing a mutation. */
export async function can(actor: Actor, action: string): Promise<boolean> {
  try {
    await assertCan(actor, action);
    return true;
  } catch {
    return false;
  }
}
