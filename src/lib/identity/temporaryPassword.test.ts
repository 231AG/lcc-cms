import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, TEMP_PASSWORD_LENGTH } from "./temporaryPassword";

/** 500 samples: enough that a missing character class or a stray "0" shows up. */
const SAMPLES = Array.from({ length: 500 }, () => generateTemporaryPassword());

describe("temporary password format", () => {
  it("is 10 characters long", () => {
    expect(TEMP_PASSWORD_LENGTH).toBe(10);
    for (const password of SAMPLES) expect(password).toHaveLength(10);
  });

  it("uses only lowercase letters and the digits 1-9", () => {
    for (const password of SAMPLES) expect(password).toMatch(/^[a-z1-9]{10}$/);
  });

  it("never contains the digit 0", () => {
    expect(SAMPLES.join("")).not.toContain("0");
  });

  it("contains no uppercase letters and no symbols", () => {
    expect(SAMPLES.join("")).not.toMatch(/[A-Z]|[^a-z1-9]/);
  });

  it("draws on the whole alphabet, not a subset", () => {
    const used = new Set(SAMPLES.join(""));
    // 35 characters over 5000 draws: every one should appear.
    expect(used.size).toBe(35);
  });

  it("does not repeat itself", () => {
    expect(new Set(SAMPLES).size).toBe(SAMPLES.length);
  });

});
