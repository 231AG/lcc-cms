import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

/**
 * Automates the manual verification done while building 0003_identity_constraints_rls.sql:
 * role immutability, the minimum-one-active-Super-Admin invariant (I-11), and
 * that app_user RLS actually scopes reads by role (REQ-R01, REQ-R02, REQ-R03)
 * while leaving all writes to service_role.
 */

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

// Random per run, not a fixed constant: another suite (e.g.
// accounts.integration.test.ts's realSuperAdminActor()) can pick up
// whichever row happens to be "the" active Super Admin at the time and
// record it as created_by on an account it creates -- that FK is RESTRICT
// (Section 9.5, "never hard-deleted"), so a fixed SUPER_ADMIN_ID here would
// permanently fail to delete the moment that ever happens once, even after
// fileParallelism was turned off for exactly this reason. A fresh id per
// run sidesteps the problem instead of relying on perfect isolation.
function newTestUuid(): string {
  return crypto.randomUUID();
}
let SUPER_ADMIN_ID: string;
let ADMIN_ID: string;
let STUDENT_ID: string;

async function wipeTestFixture(ids: string[]) {
  if (ids.length === 0) return;
  // The min-one-active-Super-Admin trigger (I-11) makes it impossible to
  // delete a Super Admin test row through the normal path once it's the
  // only one left. Disabling the trigger for this one cleanup statement is
  // the standard way to make a fixture that creates a Super Admin fully
  // re-runnable without leaving orphaned rows between test runs.
  await sql`ALTER TABLE app.app_user DISABLE TRIGGER app_user_min_super_admin`;
  try {
    await sql`DELETE FROM app.app_user WHERE id = ANY(${ids})`;
  } catch {
    // Some other suite recorded one of these ids as created_by (RESTRICT
    // FK) -- fall back to disabling rather than leaving the test unable to
    // ever finish cleanup.
    await sql`UPDATE app.app_user SET status = 'DISABLED' WHERE id = ANY(${ids})`;
  } finally {
    await sql`ALTER TABLE app.app_user ENABLE TRIGGER app_user_min_super_admin`;
  }
}

beforeAll(async () => {
  // No "wipe leftover rows from a previous interrupted run" step here:
  // ids are random per run now, so there is nothing fixed to collide with.
  SUPER_ADMIN_ID = newTestUuid();
  ADMIN_ID = newTestUuid();
  STUDENT_ID = newTestUuid();

  await sql`
    INSERT INTO app.app_user (id, login_identifier, display_name, role)
    VALUES
      (${SUPER_ADMIN_ID}, ${"test-super-admin-" + SUPER_ADMIN_ID.slice(0, 8)}, 'Test Super Admin', 'SUPER_ADMIN'),
      (${ADMIN_ID}, ${"test-admin-" + ADMIN_ID.slice(0, 8)}, 'Test Admin', 'ADMIN'),
      (${STUDENT_ID}, ${"test-student-" + STUDENT_ID.slice(0, 8)}, 'Test Student', 'STUDENT')
  `;
});

afterAll(async () => {
  await wipeTestFixture([SUPER_ADMIN_ID, ADMIN_ID, STUDENT_ID]);
  await sql.end();
});

// Scoped to this suite's own fixture rows: with a real shared database (not
// a disposable one per test file), other suites' rows are also live at the
// same time, and RLS correctly makes some of them visible too. What this
// suite verifies is "which of MY rows can this actor see", not "is the
// table's total row count exactly 3" -- the latter isn't a meaningful
// assertion once more than one test suite touches app_user.
async function selectAs(actingUserId: string) {
  const fixtureIds = [SUPER_ADMIN_ID, ADMIN_ID, STUDENT_ID];
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claim.sub', ${actingUserId}, true)`;
    await tx`SET LOCAL ROLE authenticated`;
    return tx`
      SELECT display_name, role FROM app.app_user
      WHERE id = ANY(${fixtureIds})
      ORDER BY display_name
    `;
  });
}

describe("app_user invariants", () => {
  it("refuses to change role after creation", async () => {
    await expect(
      sql`UPDATE app.app_user SET role = 'ADMIN' WHERE id = ${STUDENT_ID}`,
    ).rejects.toThrow(/role is immutable/i);
  });

  it("refuses to disable the only active Super Admin", async () => {
    // Runs inside one transaction that never commits: real data (e.g. the
    // bootstrap Super Admin) coexists in this shared table, so "the only
    // active Super Admin" has to be made true for the duration of this
    // check, without permanently touching anything outside this fixture.
    await expect(
      sql.begin(async (tx) => {
        await tx`ALTER TABLE app.app_user DISABLE TRIGGER app_user_min_super_admin`;
        await tx`UPDATE app.app_user SET status = 'DISABLED' WHERE role = 'SUPER_ADMIN' AND id != ${SUPER_ADMIN_ID}`;
        await tx`ALTER TABLE app.app_user ENABLE TRIGGER app_user_min_super_admin`;

        await tx`UPDATE app.app_user SET status = 'DISABLED' WHERE id = ${SUPER_ADMIN_ID}`;
      }),
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
