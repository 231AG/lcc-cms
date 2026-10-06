import Decimal from "decimal.js";

/**
 * A student's level -- Freshman, Sophomore, Junior or Senior -- which is
 * what the College means by a student's "Status".
 *
 * Worked out from the credit hours the student has EARNED, never stored:
 * a stored level would have to be remembered and updated every year, and
 * would be wrong the day somebody forgot. The cut-offs split the 132-hour
 * degree into four years of about 33 hours, as the College agreed
 * (6 Oct 2026): Freshman 0–32, Sophomore 33–65, Junior 66–98, Senior 99+.
 *
 * Not to be confused with `student.status` (Active, Inactive, Suspended,
 * Graduated, Admission forfeited), which is whether the student is enrolled
 * at all -- shown as "Enrollment" -- and is what decides who may plan
 * courses and register.
 */

export const STUDENT_LEVELS = ["FRESHMAN", "SOPHOMORE", "JUNIOR", "SENIOR"] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];

export const LEVEL_LABEL: Record<StudentLevel, string> = {
  FRESHMAN: "Freshman",
  SOPHOMORE: "Sophomore",
  JUNIOR: "Junior",
  SENIOR: "Senior",
};

/** The fewest earned credit hours each level starts at. */
export const LEVEL_MIN_CREDITS: Record<StudentLevel, number> = {
  FRESHMAN: 0,
  SOPHOMORE: 33,
  JUNIOR: 66,
  SENIOR: 99,
};

/**
 * The level for a number of earned credit hours. A student with no record
 * yet (null) is a Freshman. Half hours count as earned: 32.5 is still a
 * Freshman, 33 a Sophomore.
 */
export function levelForCredits(creditsEarned: Decimal.Value | null | undefined): StudentLevel {
  const credits = new Decimal(creditsEarned ?? 0);
  let level: StudentLevel = "FRESHMAN";
  for (const candidate of STUDENT_LEVELS) {
    if (credits.gte(LEVEL_MIN_CREDITS[candidate])) level = candidate;
  }
  return level;
}

/** The earned-credit range of a level: from `min`, up to but not including `below` (none for Senior). */
export function levelCreditRange(level: StudentLevel): { min: number; below: number | null } {
  const next = STUDENT_LEVELS[STUDENT_LEVELS.indexOf(level) + 1];
  return { min: LEVEL_MIN_CREDITS[level], below: next ? LEVEL_MIN_CREDITS[next] : null };
}

export function isStudentLevel(value: string | undefined): value is StudentLevel {
  return (STUDENT_LEVELS as readonly string[]).includes(value ?? "");
}
