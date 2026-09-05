import { describe, it, expect } from "vitest";
import { formatDays, expandDays } from "./offeringRows";

/**
 * The day-writing rule is per-count, so these are the boundaries: one day,
 * two days, three days, and the ordering that has to survive all three.
 */
describe("formatDays", () => {
  it("spells a single day out in full", () => {
    expect(formatDays([1])).toBe("Monday");
    expect(formatDays([4])).toBe("Thursday");
    expect(formatDays([7])).toBe("Sunday");
  });

  it("writes two days as comma-separated three-letter names", () => {
    expect(formatDays([2, 4])).toBe("Tue, Thu");
    expect(formatDays([1, 3])).toBe("Mon, Wed");
    expect(formatDays([6, 7])).toBe("Sat, Sun");
  });

  it("runs three or more days together as letters", () => {
    expect(formatDays([1, 3, 5])).toBe("MWF");
    expect(formatDays([2, 4, 6])).toBe("TThS");
    expect(formatDays([1, 2, 3, 4, 5])).toBe("MTWThF");
  });

  it("puts days in week order regardless of the order they arrive in", () => {
    expect(formatDays([5, 1, 3])).toBe("MWF");
    expect(formatDays([4, 2])).toBe("Tue, Thu");
  });

  it("returns an empty string for an unscheduled slot", () => {
    expect(formatDays([])).toBe("");
  });
});

describe("expandDays", () => {
  it("expands each form back to full day names for the tooltip", () => {
    expect(expandDays("MWF")).toBe("Monday, Wednesday, Friday");
    expect(expandDays("Tue, Thu")).toBe("Tuesday, Thursday");
    expect(expandDays("Monday")).toBe("Monday");
    expect(expandDays("")).toBe("");
  });

  it("does not confuse Thursday with Tuesday, or Sunday with Saturday", () => {
    expect(expandDays("TThS")).toBe("Tuesday, Thursday, Saturday");
    expect(expandDays(formatDays([1, 6, 7]))).toBe("Monday, Saturday, Sunday");
  });
});
