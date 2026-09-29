import { describe, expect, it } from "vitest";
import { noGradeStatus, type CalendarSemester } from "./noGrade";

const calendar: CalendarSemester[] = [
  { sortKey: { yearStart: 2025, sequence: 1 }, endDate: "2026-01-20" },
  { sortKey: { yearStart: 2025, sequence: 2 }, endDate: "2026-07-10" },
  { sortKey: { yearStart: 2026, sequence: 1 }, endDate: "2027-01-20" },
];

describe("an NG's settlement deadline", () => {
  it("is within time until the second semester after it has ended", () => {
    const s = noGradeStatus({ yearStart: 2025, sequence: 1 }, calendar, new Date("2026-09-29"));
    expect(s).toEqual({ overdue: false, deadline: { yearStart: 2026, sequence: 1 }, deadlineInCalendar: true });
  });

  it("is overdue, to be recorded as F, once that semester has ended", () => {
    const s = noGradeStatus({ yearStart: 2025, sequence: 1 }, calendar, new Date("2027-01-21"));
    expect(s.overdue).toBe(true);
  });

  it("is never overdue while the deadline semester is not yet in the calendar", () => {
    const s = noGradeStatus({ yearStart: 2025, sequence: 2 }, calendar, new Date("2030-01-01"));
    expect(s).toEqual({ overdue: false, deadline: { yearStart: 2026, sequence: 2 }, deadlineInCalendar: false });
  });
});
