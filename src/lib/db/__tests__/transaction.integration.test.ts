import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { institutionSetting } from "@/lib/db/schema";

const TEST_KEY_A = "test.transaction.a";
const TEST_KEY_B = "test.transaction.b";

afterAll(async () => {
  await db
    .delete(institutionSetting)
    .where(eq(institutionSetting.key, TEST_KEY_A));
  await db
    .delete(institutionSetting)
    .where(eq(institutionSetting.key, TEST_KEY_B));
});

describe("nothing important happens outside a transaction (plan principle P5)", () => {
  it("leaves no partial state when a transaction fails partway through", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(institutionSetting)
          .values({ key: TEST_KEY_A, value: { ok: true } });

        // Simulate a failure after the first write has been issued but
        // before commit -- this is the scenario REQ-D05 exists to prevent
        // for real mutating operations (a half-saved grade record).
        throw new Error("deliberate failure mid-transaction");
      }),
    ).rejects.toThrow("deliberate failure mid-transaction");

    const rows = await db
      .select()
      .from(institutionSetting)
      .where(eq(institutionSetting.key, TEST_KEY_A));

    expect(rows).toHaveLength(0);
  });

  it("commits every write together when the transaction succeeds", async () => {
    await db.transaction(async (tx) => {
      await tx
        .insert(institutionSetting)
        .values({ key: TEST_KEY_A, value: { ok: true } });
      await tx
        .insert(institutionSetting)
        .values({ key: TEST_KEY_B, value: { ok: true } });
    });

    const rowsA = await db
      .select()
      .from(institutionSetting)
      .where(eq(institutionSetting.key, TEST_KEY_A));
    const rowsB = await db
      .select()
      .from(institutionSetting)
      .where(eq(institutionSetting.key, TEST_KEY_B));

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });
});
