import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import { auditWrite } from "@/lib/audit/audit";

config({ path: ".env.local" });

/**
 * CI/local-only fixture -- NOT the production bootstrap procedure (that is
 * db/bootstrap.ts, which creates a real Supabase Auth user; this does not
 * and must never be pointed at a real Supabase-backed database).
 *
 * Finding, recorded during Stage 11: every integration test file from
 * Stage 3 onward follows the same `realSuperAdminActor()` pattern --
 * find an ACTIVE app_user with role SUPER_ADMIN and use it as the actor,
 * because several write paths have a real (RESTRICT) FK to app_user.id
 * for created_by/entered_by/etc. Nothing in the repository ever created
 * that row for a from-scratch database. ci.yml runs migrate -> seed ->
 * test with no bootstrap step, and no workflow run has ever executed
 * (0 runs in this repository's Actions history as of Stage 11) -- so this
 * gap was never caught. Confirmed locally: 9 of 20 test files fail
 * identically ("No active Super Admin exists...") against a freshly
 * migrated and seeded database, exactly reproducing what ci.yml does.
 *
 * `app_user.id` carries no DB-level FK to Supabase's auth.users (Section
 * 9.4.1's "matches ... one-to-one" is a convention the application
 * relies on, not a constraint Postgres enforces) -- so a synthetic id
 * with no backing Auth user satisfies every FK in this schema. It cannot
 * log in through the real UI (there is no Auth user to authenticate as),
 * which is exactly right: this fixture exists only to be a valid `actor`
 * argument for service functions called directly, the way these
 * integration tests already call them.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("supabase.co")) {
    throw new Error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL looks like a real Supabase project. " +
        "This fixture creates an app_user row with no backing Auth user and must only ever run against a throwaway/CI Postgres database.",
    );
  }

  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  const existing = await db.query.appUser.findFirst({
    where: and(eq(schema.appUser.role, "SUPER_ADMIN"), eq(schema.appUser.status, "ACTIVE")),
  });

  if (existing) {
    console.log("An active Super Admin already exists; nothing to do.");
  } else {
    const id = randomUUID();
    console.log(`Creating test-fixture Super Admin app_user row (${id})...`);
    await db.transaction(async (tx) => {
      await tx.insert(schema.appUser).values({
        id,
        loginIdentifier: "ci-test-super-admin",
        displayName: "CI Test Fixture Super Admin",
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        mustChangePassword: false,
      });
      await auditWrite(tx, {
        actorUserId: id,
        actorRole: "SUPER_ADMIN",
        action: "USER_CREATED",
        entityType: "app_user",
        entityId: id,
        newValue: { loginIdentifier: "ci-test-super-admin", role: "SUPER_ADMIN" },
        reason: "Test-fixture bootstrap for the integration suite (src/lib/db/testFixtures.ts) -- not a real account, no backing Auth user.",
      });
    });
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
