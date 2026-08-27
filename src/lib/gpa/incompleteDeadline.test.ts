import { describe, expect, it } from "vitest";
import { computeIncompleteDeadlineSemester, formatIncompleteDeadlineMessage } from "./incompleteDeadline";

describe("F-45: Incomplete resolution deadline", () => {
  it("an I awarded in First Semester 2026/2027 is due by the end of Second Semester 2026/2027", () => {
    expect(computeIncompleteDeadlineSemester({ yearStart: 2026, sequence: 1 })).toEqual({
      yearStart: 2026,
      sequence: 2,
    });
    expect(formatIncompleteDeadlineMessage({ yearStart: 2026, sequence: 1 })).toBe(
      "I -- must be resolved by end of Second Semester 2026/2027",
    );
  });

  it("an I awarded in Second Semester rolls the deadline into First Semester of the next year", () => {
    expect(computeIncompleteDeadlineSemester({ yearStart: 2026, sequence: 2 })).toEqual({
      yearStart: 2027,
      sequence: 1,
    });
  });
});
