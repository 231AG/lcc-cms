import {
  isValidStudentId,
  normalizeLoginIdentifier,
  studentIdToSyntheticIdentifier,
} from "./studentId";

/** Non-routable domain for staff (Admin/Super Admin) synthetic identities. */
export const STAFF_EMAIL_DOMAIN = "staff.lcc-eportal.invalid";

/**
 * The single place login-identifier -> synthetic-email resolution happens
 * (plan Section 8.4, "one rule, one place"). A Student-ID-shaped identifier
 * resolves to the student domain; anything else is treated as a staff
 * username. Used identically by the bootstrap script and the login action
 * so the two can never drift apart.
 */
export function resolveLoginIdentifierToEmail(identifier: string): string {
  const normalized = normalizeLoginIdentifier(identifier);
  if (isValidStudentId(normalized)) {
    return studentIdToSyntheticIdentifier(normalized);
  }
  return `${normalized}@${STAFF_EMAIL_DOMAIN}`;
}
