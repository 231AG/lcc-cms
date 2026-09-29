import type { SemesterSortKey } from "./engine";

/**
 * An Incomplete's resolution deadline (Section 16.4.5, CR-13,
 * `institution_setting.incomplete_resolution_semesters = 1`): one
 * semester, clock running from the close of the semester the I was
 * awarded in. With exactly two semesters per year (Section 13), "the
 * next semester" is fully determined by year and sequence alone -- no
 * database lookup needed, even if that future semester doesn't exist as
 * a row yet.
 */
export function computeIncompleteDeadlineSemester(awardedIn: SemesterSortKey): SemesterSortKey {
  return awardedIn.sequence === 1
    ? { yearStart: awardedIn.yearStart, sequence: 2 }
    : { yearStart: awardedIn.yearStart + 1, sequence: 1 };
}

/**
 * A No Grade's settlement deadline (decided 29 Sep 2026,
 * `institution_setting.no_grade_resolution_semesters = 2`): the two
 * semesters after the one the NG was given in. With two semesters a year
 * that is the same semester of the following academic year -- an NG from
 * 2025/2026 Semester I must be settled by the end of 2026/2027 Semester I.
 * Once that semester has ended the NG is overdue and is recorded as F.
 */
export function computeNoGradeDeadlineSemester(awardedIn: SemesterSortKey): SemesterSortKey {
  return computeIncompleteDeadlineSemester(computeIncompleteDeadlineSemester(awardedIn));
}

const SEQUENCE_NAME: Record<1 | 2, string> = { 1: "First Semester", 2: "Second Semester" };

/** "Second Semester 2026/2027" -- the year label format used everywhere else in this system. */
export function formatSemesterSortKey(key: SemesterSortKey): string {
  return `${SEQUENCE_NAME[key.sequence]} ${key.yearStart}/${key.yearStart + 1}`;
}

export function formatIncompleteDeadlineMessage(awardedIn: SemesterSortKey): string {
  const deadline = computeIncompleteDeadlineSemester(awardedIn);
  return `I -- must be resolved by end of ${formatSemesterSortKey(deadline)}`;
}

/** "2026/2027 — Semester I": the College's own way of naming a semester,
 *  used for the No Grade deadline. */
export function formatSemesterLabel(key: SemesterSortKey): string {
  return `${key.yearStart}/${key.yearStart + 1} — Semester ${key.sequence === 1 ? "I" : "II"}`;
}
