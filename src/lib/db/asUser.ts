import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";

/**
 * Runs `fn` inside a transaction scoped to a specific signed-in user: the
 * Postgres role is downgraded to `authenticated` and
 * request.jwt.claim.sub is set to their id, so RLS policies genuinely
 * apply to the query.
 *
 * Why this exists: DATABASE_URL connects as a superuser (needed for
 * migrations and for genuine service-role operations), which bypasses RLS
 * entirely. Without this wrapper, every "backend and database policies"
 * requirement (REQ-A05) would only have the backend half doing any work --
 * RLS would be dead code that happens to pass tests which manually set the
 * role, while real application queries silently bypassed it. Anything read
 * or written on a logged-in user's behalf should go through this, not
 * through `db` directly.
 *
 * NOT for account creation/reset, the bootstrap procedure, or seeding --
 * those are genuinely service-role operations and use `db` directly.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Both settings in ONE statement rather than two. `SET LOCAL ROLE x` is
    // exactly `set_config('role', x, true)`, so this is the same two
    // changes with the same transaction-local scope -- one fewer network
    // round trip on every scoped read in the app, which at ~220ms each
    // against Supabase is worth more than it looks.
    //
    // Order within the target list is deliberately not relied on: both
    // orderings were tested against the live database and produce an
    // identical result (role downgraded, claim set, a student seeing
    // exactly their own row and not all 158). `request.jwt.claim.sub` is a
    // custom GUC, which any role may set, so switching role first cannot
    // lock out the other call.
    await tx.execute(
      sql`SELECT set_config('request.jwt.claim.sub', ${userId}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}
