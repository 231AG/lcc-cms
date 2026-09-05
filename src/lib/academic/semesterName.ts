/**
 * How a semester is named on screen, in one place.
 *
 * The College refers to its two terms as "Semester I" and "Semester II", so
 * that is what every screen shows. The stored `semester.name` column is left
 * exactly as it is -- it holds whatever an Admin typed when the semester was
 * created ("First Semester", and on older rows possibly something else
 * again), and rewriting live rows to fix a label would be a data migration in
 * service of a display preference.
 *
 * So the display name is derived from `sequence`, which is the column that
 * actually carries the meaning: CR-10 constrains it to exactly 1 or 2 per
 * academic year. Anything outside that pair -- which the schema does not
 * currently allow, but might one day -- falls back to the stored name rather
 * than inventing a numeral for it.
 */

const NUMERAL: Record<number, string> = { 1: "I", 2: "II" };

export interface NamedSemester {
  sequence: number;
  name: string;
}

/** "Semester I" / "Semester II". */
export function semesterDisplayName(semester: NamedSemester): string {
  const numeral = NUMERAL[semester.sequence];
  return numeral ? `Semester ${numeral}` : semester.name;
}

/** "I" / "II" on its own, for the grade sheet's Semester field. */
export function semesterNumeral(semester: NamedSemester): string {
  return NUMERAL[semester.sequence] ?? String(semester.sequence);
}

/**
 * "2026/2027 — Semester I": the full label every semester picker and page
 * heading uses. Both arguments are optional so a caller with a missing join
 * gets the fallback instead of having to guard at each call site.
 */
export function semesterFullLabel(
  year: { label: string } | undefined,
  semester: NamedSemester | undefined,
  fallback = "",
): string {
  if (!semester) return fallback;
  const display = semesterDisplayName(semester);
  return year ? `${year.label} — ${display}` : display;
}

/**
 * The two names a semester may be given, and the `sequence` each implies.
 *
 * The create form used to ask for a free-text Name AND a separate Sequence,
 * which are two ways of saying the same thing and could disagree -- a
 * semester named "First Semester" with sequence 2 was accepted. One choice
 * now produces both, so they cannot.
 */
export const SEMESTER_NAME_OPTIONS = [
  { name: "Semester I", sequence: 1 as const },
  { name: "Semester II", sequence: 2 as const },
];

/** The sequence a chosen name implies; undefined for anything not on the
 *  list, which the service layer then rejects. */
export function sequenceForName(name: string): 1 | 2 | undefined {
  return SEMESTER_NAME_OPTIONS.find((o) => o.name === name.trim())?.sequence;
}
