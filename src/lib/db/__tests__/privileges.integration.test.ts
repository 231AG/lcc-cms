import { describe, expect, it, afterAll } from "vitest";
import postgres from "postgres";

/**
 * Verifies DER-20 at the only level that actually matters: the database
 * privilege grant, not application code. These run as the `postgres`
 * superuser connection but use SET LOCAL ROLE to assume the restricted
 * roles for the duration of one transaction, which is the direct way to
 * prove what those roles can and cannot do (plan Section 23.1: "row-level
 * security ... cannot be tested against a mock").
 *
 * NOTE for Stage 2: this proves the grants are correct. It does not yet
 * prove the *deployed application* connects as a role this restricted --
 * that wiring (per-request Postgres role scoped to `authenticated` with the
 * caller's JWT claims) is Stage 2 work alongside RLS policy authoring.
 */

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

afterAll(async () => {
  await sql`DELETE FROM audit.audit_log WHERE entity_type = 'privilege_test'`;
  await sql.end();
});

describe("audit_log privilege boundary", () => {
  it("allows INSERT as authenticated", async () => {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      const rows = await tx`
        INSERT INTO audit.audit_log (action, entity_type, entity_id, new_value)
        VALUES ('TEST_ACTION', 'privilege_test', 'insert-ok', '{"x":1}'::jsonb)
      `;
      expect(rows.count).toBe(1);
    });
  });

  it("refuses UPDATE as authenticated", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`UPDATE audit.audit_log SET reason = 'tampered' WHERE entity_type = 'privilege_test'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses DELETE as authenticated", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`DELETE FROM audit.audit_log WHERE entity_type = 'privilege_test'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses INSERT as anon (no grant at all)", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`
          INSERT INTO audit.audit_log (action, entity_type, entity_id, new_value)
          VALUES ('TEST_ACTION', 'privilege_test', 'anon-should-fail', '{}'::jsonb)
        `;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("survives an UPDATE attempt with the row still intact and unchanged", async () => {
    const rows = await sql`
      SELECT reason FROM audit.audit_log
      WHERE entity_type = 'privilege_test' AND entity_id = 'insert-ok'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBeNull();
  });
});
