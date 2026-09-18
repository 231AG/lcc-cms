import { describe, it, expect } from "vitest";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";

describe("formatCourseCode", () => {
  it("inserts the space", () => {
    expect(formatCourseCode("ACCT101")).toBe("ACCT 101");
    expect(formatCourseCode("Acc101")).toBe("Acc 101");
    expect(formatCourseCode("BIOL205")).toBe("BIOL 205");
  });
  it("leaves an already-spaced code alone", () => {
    expect(formatCourseCode("BSPH 401")).toBe("BSPH 401");
    expect(formatCourseCode("  THEO 110 ")).toBe("THEO 110");
  });
  it("collapses odd spacing rather than doubling it", () => {
    expect(formatCourseCode("CSC   201")).toBe("CSC 201");
  });
  it("passes through anything that is not letters-then-digits", () => {
    expect(formatCourseCode("SEMINAR")).toBe("SEMINAR");
    expect(formatCourseCode("101")).toBe("101");
    expect(formatCourseCode("")).toBe("");
  });
  it("keeps a suffix attached to the number", () => {
    expect(formatCourseCode("ENG101A")).toBe("ENG 101A");
  });
});

describe("courseCodeKey", () => {
  it("makes every spelling of one code the same key", () => {
    // The real case: CECS201 in the database, "CECS 201" typed by a person.
    expect(courseCodeKey("CECS 201")).toBe(courseCodeKey("CECS201"));
    expect(courseCodeKey("cecs201")).toBe(courseCodeKey("CECS  201"));
    expect(courseCodeKey(" CECS201 ")).toBe("cecs201");
  });

  it("keeps different courses apart", () => {
    expect(courseCodeKey("CECS201")).not.toBe(courseCodeKey("CECS210"));
    expect(courseCodeKey("CECS201")).not.toBe(courseCodeKey("BSPH201"));
  });

  it("round-trips with the displayed form", () => {
    // What a reader sees can always be typed back in.
    expect(courseCodeKey(formatCourseCode("CECS201"))).toBe(courseCodeKey("CECS201"));
  });
});
