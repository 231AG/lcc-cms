/**
 * Student-ID format and the synthetic-identity mapping (plan Section 18.3,
 * CR-08, DEC-02, DEC-29 -- acknowledged and approved by the project owner).
 *
 * Digits only. First four digits are the admission year. Total length 6-8
 * digits, so an intake larger than 99 students in one year is
 * representable.
 */
export const STUDENT_ID_PATTERN = /^(19|20)\d{2}\d{2,4}$/;

/** Non-routable domain for the synthetic auth identifier. Never a real mail domain. */
export const SYNTHETIC_EMAIL_DOMAIN = "students.lcc-eportal.invalid";

export function normalizeLoginIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidStudentId(raw: string): boolean {
  return STUDENT_ID_PATTERN.test(raw.trim());
}

/**
 * Resolves a Student ID to the deterministic, non-deliverable internal
 * identifier Supabase Auth stores in place of a real email address.
 * Students are never shown this value and never asked for it -- they only
 * ever type their Student ID (Section 18.3).
 *
 * Throws rather than silently accepting a malformed ID: this function sits
 * directly in front of authentication, and a loose format check here would
 * be a validation gap in a security-relevant path.
 */
export function studentIdToSyntheticIdentifier(studentId: string): string {
  const normalized = normalizeLoginIdentifier(studentId);
  if (!isValidStudentId(normalized)) {
    throw new Error(`Invalid Student ID format: "${studentId}"`);
  }
  return `${normalized}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
