import { describe, it, expect } from "vitest";
import { editDistanceAtMost, findNearbyCourseCodes } from "./courseCodeMatch";

const CATALOGUE = [
  { code: "ACCT101", title: "Introduction to Financial Accounting I" },
  { code: "ACCT102", title: "Introduction to Financial Accounting II" },
  { code: "BSPH401", title: "Public Health Practicum Rotation III" },
  { code: "ENGL101", title: "Freshman English I" },
  { code: "MATH101", title: "Business Mathematics I" },
];

describe("editDistanceAtMost", () => {
  it("is zero for the same string", () => {
    expect(editDistanceAtMost("acct101", "acct101", 1)).toBe(0);
  });

  it("counts a single substitution, insertion or deletion as one", () => {
    expect(editDistanceAtMost("acct101", "acct102", 1)).toBe(1);
    expect(editDistanceAtMost("acct101", "acct1011", 1)).toBe(1);
    expect(editDistanceAtMost("acct101", "acct11", 1)).toBe(1);
  });

  it("gives up rather than counting past the cap", () => {
    // The exact number does not matter to a caller asking "is this close?",
    // only that it is over the cap -- which is what lets the walk stop early.
    expect(editDistanceAtMost("acct101", "bsph401", 1)).toBeGreaterThan(1);
    expect(editDistanceAtMost("a", "abcdefgh", 1)).toBeGreaterThan(1);
  });
});

describe("findNearbyCourseCodes", () => {
  it("catches the letter-O-for-zero typo, which reads as no difference at all", () => {
    const found = findNearbyCourseCodes("BSPH4O1", CATALOGUE);
    expect(found.map((c) => c.code)).toEqual(["BSPH401"]);
  });

  it("catches a one-character slip", () => {
    expect(findNearbyCourseCodes("ACCT103", CATALOGUE).map((c) => c.code)).toEqual(["ACCT101", "ACCT102"]);
  });

  it("matches however the code is spaced or cased, like every other lookup", () => {
    expect(findNearbyCourseCodes("bsph 4o1", CATALOGUE).map((c) => c.code)).toEqual(["BSPH401"]);
  });

  it("suggests nothing for a code that is genuinely new", () => {
    // The whole point: a real new course must not be buried under a
    // confirmation prompt listing courses it has nothing to do with.
    expect(findNearbyCourseCodes("HIST205", CATALOGUE)).toEqual([]);
  });

  it("never suggests the code itself", () => {
    expect(findNearbyCourseCodes("ACCT101", CATALOGUE).map((c) => c.code)).toEqual(["ACCT102"]);
  });

  it("returns nothing for an empty code rather than the whole catalogue", () => {
    expect(findNearbyCourseCodes("", CATALOGUE)).toEqual([]);
    expect(findNearbyCourseCodes("   ", CATALOGUE)).toEqual([]);
  });

  it("caps how many it offers", () => {
    const manyNeighbours = ["CHEM10", "CHEM100", "CHEM102", "CHEM103", "CHEM104", "CHEM105"].map((code) => ({
      code,
      title: code,
    }));
    expect(findNearbyCourseCodes("CHEM101", manyNeighbours, 3)).toHaveLength(3);
  });
});
