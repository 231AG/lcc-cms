import { describe, expect, it } from "vitest";
import {
  isValidStudentId,
  normalizeLoginIdentifier,
  studentIdToSyntheticIdentifier,
  SYNTHETIC_EMAIL_DOMAIN,
} from "./studentId";

describe("Student ID format (CR-08)", () => {
  it.each([
    "202634", // 6 digits, minimum length
    "20263412", // 8 digits, maximum length
    "19991234", // starts with 19, 8 digits (maximum length)
  ])("accepts %s", (id) => {
    expect(isValidStudentId(id)).toBe(true);
  });

  it.each([
    "12634", // 5 digits, too short
    "203263412", // 9 digits, too long
    "18263412", // starts with 18, not 19/20
    "abc12345", // not digits
    "", // empty
  ])("rejects %s", (id) => {
    expect(isValidStudentId(id)).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isValidStudentId("  202634  ")).toBe(true);
  });
});

describe("normalizeLoginIdentifier", () => {
  it("trims and lowercases", () => {
    expect(normalizeLoginIdentifier("  Admin1  ")).toBe("admin1");
  });
});

describe("studentIdToSyntheticIdentifier (Section 18.3, DEC-29)", () => {
  it("maps a valid Student ID to the non-deliverable synthetic domain", () => {
    expect(studentIdToSyntheticIdentifier("202634")).toBe(
      `202634@${SYNTHETIC_EMAIL_DOMAIN}`,
    );
  });

  it("normalizes before mapping", () => {
    expect(studentIdToSyntheticIdentifier("  202634  ")).toBe(
      `202634@${SYNTHETIC_EMAIL_DOMAIN}`,
    );
  });

  it("throws on an invalid Student ID rather than silently accepting it", () => {
    expect(() => studentIdToSyntheticIdentifier("not-an-id")).toThrow(
      /invalid student id/i,
    );
  });
});
