import { describe, expect, it, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { idempotencyKey, institutionSetting } from "@/lib/db/schema";
import { runIdempotent } from "@/lib/tx/idempotent";
import { ValidationError } from "@/lib/errors";

const TEST_KEY = "test.idempotent.settingkey";

beforeEach(async () => {
  await db.delete(idempotencyKey).where(eq(idempotencyKey.key, "test-idem-key"));
  await db
    .delete(institutionSetting)
    .where(eq(institutionSetting.key, TEST_KEY));
});

afterAll(async () => {
  await db.delete(idempotencyKey).where(eq(idempotencyKey.key, "test-idem-key"));
  await db
    .delete(institutionSetting)
    .where(eq(institutionSetting.key, TEST_KEY));
});

describe("runIdempotent (DER-13)", () => {
  it("runs the operation exactly once for a new key", async () => {
    let calls = 0;

    const result = await runIdempotent({
      key: "test-idem-key",
      operation: "test.write",
      requestPayload: { value: 1 },
      run: async (tx) => {
        calls += 1;
        await tx
          .insert(institutionSetting)
          .values({ key: TEST_KEY, value: { value: 1 } });
        return { written: true };
      },
    });

    expect(calls).toBe(1);
    expect(result).toEqual({ written: true });
  });

  it("replays the stored result without re-running the operation", async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      return { written: true, callNumber: calls };
    };

    const first = await runIdempotent({
      key: "test-idem-key",
      operation: "test.write",
      requestPayload: { value: 1 },
      run,
    });
    const second = await runIdempotent({
      key: "test-idem-key",
      operation: "test.write",
      requestPayload: { value: 1 },
      run,
    });

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("rejects the same key reused with a different payload", async () => {
    await runIdempotent({
      key: "test-idem-key",
      operation: "test.write",
      requestPayload: { value: 1 },
      run: async () => ({ written: true }),
    });

    await expect(
      runIdempotent({
        key: "test-idem-key",
        operation: "test.write",
        requestPayload: { value: 2 }, // different payload, same key
        run: async () => ({ written: true }),
      }),
    ).rejects.toThrow(ValidationError);
  });
});
