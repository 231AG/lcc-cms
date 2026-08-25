import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { asUser } from "@/lib/db/asUser";
import { appUser } from "@/lib/db/schema";

/**
 * Proves asUser() closes the gap flagged while building the login flow:
 * without it, every server-side read/write would run through the
 * superuser DATABASE_URL connection and silently bypass every RLS policy
 * in identity_rls.integration.test.ts. This test would have caught that --
 * it exercises the exact helper the application actually calls
 * (getCurrentActor), not a hand-rolled SET ROLE like the other RLS suite.
 */

const raw = postgres(process.env.DATABASE_URL!, { prepare: false });

const USER_A = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

async function wipe() {
  await raw`ALTER TABLE app.app_user DISABLE TRIGGER app_user_min_super_admin`;
  await raw`DELETE FROM app.app_user WHERE id IN (${USER_A}, ${USER_B})`;
  await raw`ALTER TABLE app.app_user ENABLE TRIGGER app_user_min_super_admin`;
}

beforeAll(async () => {
  await wipe();
  await raw`
    INSERT INTO app.app_user (id, login_identifier, display_name, role)
    VALUES
      (${USER_A}, 'test-as-user-a', 'Student A', 'STUDENT'),
      (${USER_B}, 'test-as-user-b', 'Student B', 'STUDENT')
  `;
});

afterAll(async () => {
  await wipe();
  await raw.end();
});

describe("asUser", () => {
  it("lets a user read their own row through RLS", async () => {
    const row = await asUser(USER_A, (tx) =>
      tx.query.appUser.findFirst({ where: eq(appUser.id, USER_A) }),
    );
    expect(row?.id).toBe(USER_A);
  });

  it("does not let a user read someone else's row, even by direct id", async () => {
    const row = await asUser(USER_A, (tx) =>
      tx.query.appUser.findFirst({ where: eq(appUser.id, USER_B) }),
    );
    expect(row).toBeUndefined();
  });

  it("refuses a write attempt made through this helper (no write policy for authenticated)", async () => {
    // Drizzle wraps the underlying driver error rather than surfacing its
    // message directly on `.message` -- the real Postgres refusal is on
    // `.cause`, which is what actually proves the privilege check fired.
    let caught: unknown;
    try {
      await asUser(USER_A, (tx) =>
        tx.update(appUser).set({ displayName: "Hacked" }).where(eq(appUser.id, USER_A)),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error).cause;
    expect(String((cause as Error)?.message ?? caught)).toMatch(/permission denied/i);
  });
});
