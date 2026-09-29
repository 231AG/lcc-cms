import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, activityCookieValue, isIdle, readLastActivity } from "./idle";

const SECRET = "test-secret";

describe("idle sign-out", () => {
  it("reads back the time it signed, for the same session", async () => {
    const v = await activityCookieValue("session-a", 1_700_000_000_000, SECRET);
    expect(await readLastActivity(v, "session-a", SECRET)).toBe(1_700_000_000_000);
  });

  it("refuses a cookie from another session, an edited time, or another secret", async () => {
    const v = await activityCookieValue("session-a", 1_700_000_000_000, SECRET);
    expect(await readLastActivity(v, "session-b", SECRET)).toBeNull();
    expect(await readLastActivity(v.replace(/^\d+/, "1800000000000"), "session-a", SECRET)).toBeNull();
    expect(await readLastActivity(v, "session-a", "other-secret")).toBeNull();
    expect(await readLastActivity("garbage", "session-a", SECRET)).toBeNull();
    expect(await readLastActivity(undefined, "session-a", SECRET)).toBeNull();
  });

  it("is idle only after a full hour without activity", () => {
    const t = 1_700_000_000_000;
    expect(IDLE_TIMEOUT_MS).toBe(60 * 60 * 1000);
    expect(isIdle(t, t + IDLE_TIMEOUT_MS)).toBe(false);
    expect(isIdle(t, t + IDLE_TIMEOUT_MS + 1)).toBe(true);
  });
});
