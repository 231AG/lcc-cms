import { describe, expect, it } from "vitest";
import { computeIncompleteDeadlineSemester, computeNoGradeDeadlineSemester, formatIncompleteDeadlineMessage } from "./incompleteDeadline";

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

describe("No Grade deadline", () => {
  it("an NG from Semester I must be settled by the end of Semester I of the next year", () => {
    expect(computeNoGradeDeadlineSemester({ yearStart: 2025, sequence: 1 })).toEqual({ yearStart: 2026, sequence: 1 });
  });

  it("an NG from Semester II must be settled by the end of Semester II of the next year", () => {
    expect(computeNoGradeDeadlineSemester({ yearStart: 2025, sequence: 2 })).toEqual({ yearStart: 2026, sequence: 2 });
  });
});
