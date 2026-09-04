import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  isObviousPassword,
  passwordPolicyFor,
  STAFF_PASSWORD_POLICY,
  STUDENT_PASSWORD_POLICY,
} from "./passwordPolicy";

describe("password policy per role", () => {
  it("gives students the simple rule and everyone else the staff rule", () => {
    expect(passwordPolicyFor("STUDENT")).toBe(STUDENT_PASSWORD_POLICY);
    expect(passwordPolicyFor("ADMIN")).toBe(STAFF_PASSWORD_POLICY);
    expect(passwordPolicyFor("SUPER_ADMIN")).toBe(STAFF_PASSWORD_POLICY);
  });

  it("falls back to the stricter staff rule when the role is unknown", () => {
    expect(passwordPolicyFor(undefined)).toBe(STAFF_PASSWORD_POLICY);
  });
});

describe("student rule: 6+ characters, at least one number and one lowercase letter", () => {
  it.each([
    "abc12d", // exactly the 6-character minimum
    "mary2024", // ordinary case
    "kollie99pass",
    "a1bcdef", // one digit is enough
  ])("accepts %s", (password) => {
    expect(checkPasswordPolicy(password, STUDENT_PASSWORD_POLICY)).toBeNull();
  });

  it.each([
    ["ab12c", "only 5 characters"],
    ["abcdef", "no number"],
    ["123456789", "no lowercase letter"],
    ["ABC123", "uppercase only, no lowercase letter"],
    ["", "empty"],
  ])("rejects %s (%s)", (password) => {
    expect(checkPasswordPolicy(password, STUDENT_PASSWORD_POLICY)).toBe("TOO_SIMPLE");
  });

  it("does NOT require uppercase or a symbol", () => {
    expect(checkPasswordPolicy("monrovia7", STUDENT_PASSWORD_POLICY)).toBeNull();
  });
});

describe("staff rule is unchanged by the student rule", () => {
  it("still requires 10 characters", () => {
    expect(checkPasswordPolicy("abc12345", STAFF_PASSWORD_POLICY)).toBe("TOO_SIMPLE");
    expect(checkPasswordPolicy("abc1234567", STAFF_PASSWORD_POLICY)).toBeNull();
  });

  it("accepts a password with no digit or lowercase letter, as before", () => {
    expect(checkPasswordPolicy("ABCDEFGHIJ", STAFF_PASSWORD_POLICY)).toBeNull();
  });
});

describe("obvious-password rejection list", () => {
  it("rejects short obvious values now reachable under the 6-character minimum", () => {
    expect(isObviousPassword("abc123")).toBe(true);
    expect(isObviousPassword("123456")).toBe(true);
    expect(isObviousPassword("qwerty")).toBe(true);
  });

  it("still rejects the longer values it always did", () => {
    expect(isObviousPassword("password123")).toBe(true);
    expect(isObviousPassword("Welcome123")).toBe(true);
  });

  it("accepts an ordinary password", () => {
    expect(isObviousPassword("mary2024")).toBe(false);
  });
});
