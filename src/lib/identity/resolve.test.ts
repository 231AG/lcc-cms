import { describe, expect, it } from "vitest";
import { resolveLoginIdentifierToEmail, STAFF_EMAIL_DOMAIN } from "./resolve";
import { SYNTHETIC_EMAIL_DOMAIN } from "./studentId";

describe("resolveLoginIdentifierToEmail", () => {
  it("resolves a Student-ID-shaped identifier to the student domain", () => {
    expect(resolveLoginIdentifierToEmail("202634")).toBe(
      `202634@${SYNTHETIC_EMAIL_DOMAIN}`,
    );
  });

  it("resolves anything else to the staff domain", () => {
    expect(resolveLoginIdentifierToEmail("vpaa.admin")).toBe(
      `vpaa.admin@${STAFF_EMAIL_DOMAIN}`,
    );
  });

  it("normalizes before resolving either way", () => {
    expect(resolveLoginIdentifierToEmail("  VPAA.Admin  ")).toBe(
      `vpaa.admin@${STAFF_EMAIL_DOMAIN}`,
    );
  });
});
