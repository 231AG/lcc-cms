import type { Role } from "@/lib/permissions/kernel";

/**
 * The rules a *self-chosen* password must satisfy, per role.
 *
 * Students and staff are deliberately not held to the same rule. Students
 * are handed a credential on paper and log in from a shared lab machine;
 * the requested rule for them is exactly six characters with one number
 * and one lowercase letter -- no uppercase requirement, no symbol
 * requirement -- matching the simplicity of the temporary password they
 * are issued (see generateTemporaryPassword in lib/students/students.ts).
 * Admin and Super Admin accounts can create students, reset passwords and
 * approve grades, so their existing 10-character minimum is left exactly
 * as it was: nothing here weakens a staff password.
 */
export interface PasswordPolicy {
  minLength: number;
  requireDigit: boolean;
  requireLowercase: boolean;
  /** One sentence, shown as the form hint and inside the error message. */
  description: string;
}

export const STUDENT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 6,
  requireDigit: true,
  requireLowercase: true,
  description: "at least 6 characters, including at least one number and one lowercase letter",
};

export const STAFF_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireDigit: false,
  requireLowercase: false,
  description: "at least 10 characters",
};

/**
 * Anything that is not positively known to be a Student gets the stricter
 * staff policy -- including an unknown/missing role, so a lookup that
 * fails cannot silently relax the rule.
 */
export function passwordPolicyFor(role: Role | undefined): PasswordPolicy {
  return role === "STUDENT" ? STUDENT_PASSWORD_POLICY : STAFF_PASSWORD_POLICY;
}

/**
 * §18 RECOMMENDED: "Password policy -- minimum length with a rejection
 * list of obvious values." Small and deliberately so: the plan explicitly
 * rules out forced periodic rotation ("reliably produces weaker passwords
 * written on desks") and this app has no external breach-database check
 * available -- this catches the obvious case (a temporary/reset password
 * left unchanged in substance, or a keyboard-walk) without pretending to
 * be a full password-strength library.
 */
const OBVIOUS_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd",
  "12345678", "123456789", "1234567890", "qwertyuiop",
  "letmein123", "changeme123", "welcome123", "admin1234",
  // Short enough to be reachable under the 6-character student minimum,
  // which the 8+ entries above are not.
  "123456", "1234567", "abc123", "qwerty", "qwerty1", "iloveyou",
]);

export function isObviousPassword(password: string): boolean {
  const normalized = password.toLowerCase().replace(/\s+/g, "");
  return OBVIOUS_PASSWORDS.has(normalized);
}

/**
 * Returns null when the password satisfies the policy, or the reason it
 * does not. Shape-only: the caller decides what to do about it (the
 * change-password action redirects with an error code; the page renders
 * the same policy as a hint before anything is typed).
 */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy): "TOO_SIMPLE" | null {
  if (password.length < policy.minLength) return "TOO_SIMPLE";
  if (policy.requireDigit && !/[0-9]/.test(password)) return "TOO_SIMPLE";
  if (policy.requireLowercase && !/[a-z]/.test(password)) return "TOO_SIMPLE";
  return null;
}
