import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

/**
 * Automates the manual verification done while building 0003_identity_constraints_rls.sql:
 * role immutability, the minimum-one-active-Super-Admin invariant (I-11), and
 * that app_user RLS actually scopes reads by role (REQ-R01, REQ-R02, REQ-R03)
 * while leaving all writes to service_role.
 */

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

const SUPER_ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const STUDENT_ID = "aaaaaaaa-0000-0000-0000-000000000003";

async function wipeTestFixture() {
  // The min-one-active-Super-Admin trigger (I-11) makes it impossible to
  // delete a Super Admin test row through the normal path once it's the
  // only one left. Disabling the trigger for this one cleanup statement is
  // the standard way to make a fixture that creates a Super Admin fully
  // re-runnable without leaving orphaned rows between test runs.
  await sql`ALTER TABLE app.app_user DISABLE TRIGGER app_user_min_super_admin`;
  await sql`DELETE FROM app.app_user WHERE id IN (${SUPER_ADMIN_ID}, ${ADMIN_ID}, ${STUDENT_ID})`;
  await sql`ALTER TABLE app.app_user ENABLE TRIGGER app_user_min_super_admin`;
}

beforeAll(async () => {
  await wipeTestFixture(); // in case a previous interrupted run left rows behind
  await sql`
    INSERT INTO app.app_user (id, login_identifier, display_name, role)
    VALUES
      (${SUPER_ADMIN_ID}, 'test-super-admin', 'Test Super Admin', 'SUPER_ADMIN'),
      (${ADMIN_ID}, 'test-admin', 'Test Admin', 'ADMIN'),
      (${STUDENT_ID}, 'test-student', 'Test Student', 'STUDENT')
  `;
});

afterAll(async () => {
  await wipeTestFixture();
  await sql.end();
});

async function selectAs(actingUserId: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claim.sub', ${actingUserId}, true)`;
    await tx`SET LOCAL ROLE authenticated`;
    return tx`SELECT display_name, role FROM app.app_user ORDER BY display_name`;
  });
}

describe("app_user invariants", () => {
  it("refuses to change role after creation", async () => {
    await expect(
      sql`UPDATE app.app_user SET role = 'ADMIN' WHERE id = ${STUDENT_ID}`,
    ).rejects.toThrow(/role is immutable/i);
  });

  it("refuses to disable the only active Super Admin", async () => {
    await expect(
      sql`UPDATE app.app_user SET status = 'DISABLED' WHERE id = ${SUPER_ADMIN_ID}`,
    ).rejects.toThrow(/at least one active super admin/i);
  });
});

describe("app_user RLS (REQ-R01/R02/R03)", () => {
  it("a student sees only their own row", async () => {
    const rows = await selectAs(STUDENT_ID);
    expect(rows.map((r) => r.role)).toEqual(["STUDENT"]);
  });

  it("an admin sees their own row plus student rows, but not the Super Admin's", async () => {
    const rows = await selectAs(ADMIN_ID);
    const roles = rows.map((r) => r.role).sort();
    expect(roles).toEqual(["ADMIN", "STUDENT"]);
  });

  it("a super admin sees every row", async () => {
    const rows = await selectAs(SUPER_ADMIN_ID);
    const roles = rows.map((r) => r.role).sort();
    expect(roles).toEqual(["ADMIN", "STUDENT", "SUPER_ADMIN"]);
  });

  it("refuses any write attempt as authenticated, regardless of role", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claim.sub', ${STUDENT_ID}, true)`;
        await tx`SET LOCAL ROLE authenticated`;
        await tx`UPDATE app.app_user SET display_name = 'Hacked' WHERE id = ${STUDENT_ID}`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
