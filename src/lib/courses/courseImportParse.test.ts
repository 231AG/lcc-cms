import { describe, it, expect } from "vitest";
import { parseCourseList, summarisePrefixes } from "./courseImportParse";

describe("parseCourseList", () => {
  it("reads one course per line", () => {
    const { courses, problems } = parseCourseList(
      ["ACCT101 | Introduction to Financial Accounting I | 3", "ENGL101 | Freshman English I | 3"].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(courses).toEqual([
      { code: "ACCT101", title: "Introduction to Financial Accounting I", creditHours: 3, prefix: "ACCT", position: 1 },
      { code: "ENGL101", title: "Freshman English I", creditHours: 3, prefix: "ENGL", position: 2 },
    ]);
  });

  it("reads a catalogue pasted out of a PDF, where line breaks fall mid-title", () => {
    // This is verbatim from the College's own catalogue text. The breaks
    // land inside "Cost\nAccounting II" and between records alike, which is
    // exactly why records are found by their code rather than by line.
    const fromPdf = `ACCT202 | Cost Accounting I | 3 ACCT203 | Intermediate Accounting II | 3 ACCT301 | Cost
Accounting II | 3 ACCT302 | Accounting Information System | 2 ACCT303 | Principles of
Marketing | 2`;
    const { courses, problems } = parseCourseList(fromPdf);
    expect(problems).toEqual([]);
    expect(courses.map((c) => [c.code, c.title, c.creditHours])).toEqual([
      ["ACCT202", "Cost Accounting I", 3],
      ["ACCT203", "Intermediate Accounting II", 3],
      ["ACCT301", "Cost Accounting II", 3],
      ["ACCT302", "Accounting Information System", 2],
      ["ACCT303", "Principles of Marketing", 2],
    ]);
  });

  it("stops at the headings that mark the end of the clean list", () => {
    const { courses } = parseCourseList(`COURSES
ACCT202 | Cost Accounting I | 3
CONFLICTS
ACCT101 | "Introduction to Financial Accounting I" (3 cr) || "Principles of Accounting I" (3 cr)`);
    // The conflicts section describes courses the source document
    // contradicts itself about. Importing them would be picking a title on
    // the College's behalf.
    expect(courses.map((c) => c.code)).toEqual(["ACCT202"]);
  });

  it("normalises the code and leaves the title exactly as written", () => {
    const { courses } = parseCourseList("acct 101 | Research Methods for Accounting & Finance | 2");
    expect(courses[0].code).toBe("ACCT101");
    expect(courses[0].title).toBe("Research Methods for Accounting & Finance");
  });

  it("accepts a laboratory code with its trailing letter", () => {
    const { courses } = parseCourseList("BIOL111L | Introduction to Biology Lab I | 1");
    expect(courses[0].code).toBe("BIOL111L");
    expect(courses[0].prefix).toBe("BIOL");
  });

  it("accepts tabs, for a paste out of a table", () => {
    const { courses } = parseCourseList("MATH101\tBusiness Mathematics I\t3");
    expect(courses[0]).toMatchObject({ code: "MATH101", title: "Business Mathematics I", creditHours: 3 });
  });

  it("reports what it could not read rather than dropping it", () => {
    // Silently skipping is how you get 780 of 796 courses and no idea
    // which sixteen went missing.
    const { courses, problems } = parseCourseList(
      ["ACCT101 | Introduction to Financial Accounting I | 3", "MINOR | (blank) | (blank)"].join("\n"),
    );
    expect(courses).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0].text).toContain("MINOR");
  });

  it("keeps the first of a repeated code and says the others were there", () => {
    const { courses, duplicates } = parseCourseList(
      [
        "ACCT101 | Introduction to Financial Accounting I | 3",
        "ACCT101 | Principles of Accounting I | 3",
        "ENGL101 | Freshman English I | 3",
      ].join("\n"),
    );
    expect(courses.map((c) => c.code)).toEqual(["ACCT101", "ENGL101"]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].code).toBe("ACCT101");
    expect(duplicates[0].kept.title).toBe("Introduction to Financial Accounting I");
    expect(duplicates[0].alsoSeen[0].title).toBe("Principles of Accounting I");
  });

  it("finds nothing in an empty paste, and says so quietly", () => {
    expect(parseCourseList("")).toEqual({ courses: [], problems: [], duplicates: [] });
    expect(parseCourseList("   \n  \n ")).toEqual({ courses: [], problems: [], duplicates: [] });
  });
});

describe("summarisePrefixes", () => {
  it("counts each subject, commonest first", () => {
    const { courses } = parseCourseList(
      [
        "ACCT101 | One | 3",
        "ACCT102 | Two | 3",
        "ACCT201 | Three | 3",
        "ENGL101 | Four | 3",
        "MATH101 | Five | 3",
      ].join("\n"),
    );
    expect(summarisePrefixes(courses)).toEqual([
      { prefix: "ACCT", count: 3 },
      { prefix: "ENGL", count: 1 },
      { prefix: "MATH", count: 1 },
    ]);
  });
});
