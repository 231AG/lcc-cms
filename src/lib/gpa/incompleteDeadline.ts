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

const SEQUENCE_NAME: Record<1 | 2, string> = { 1: "First Semester", 2: "Second Semester" };

/** "Second Semester 2026/2027" -- the year label format used everywhere else in this system. */
export function formatSemesterSortKey(key: SemesterSortKey): string {
  return `${SEQUENCE_NAME[key.sequence]} ${key.yearStart}/${key.yearStart + 1}`;
}

export function formatIncompleteDeadlineMessage(awardedIn: SemesterSortKey): string {
  const deadline = computeIncompleteDeadlineSemester(awardedIn);
  return `I -- must be resolved by end of ${formatSemesterSortKey(deadline)}`;
}
