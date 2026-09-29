import { describe, expect, it } from "vitest";
import {
  academicYearFor,
  analyseGradeSheetCsv,
  mayBeSamePerson,
  namesMatch,
  parseCsv,
  planPastSemester,
  type ImportContext,
} from "../gradeSheetImportCore";

const HEADER =
  "source_file,page,sheet_no,student_id,student_name,school,major,minor,class_level,sheet_year,semester_raw,semester_number,course_title,course_number,section,grade,credit_hours,grade_points,sheet_gpa,flags,notes";

function csv(...rows: string[]) {
  return [HEADER, ...rows].join("\n");
}

/** One sheet row: only the fields the importer reads vary. */
function row(o: Partial<Record<string, string>> = {}) {
  const v = {
    source_file: "a.pdf",
    page: "1",
    sheet_no: "1",
    student_id: "2024853",
    student_name: "Abraham B Coleman",
    sheet_year: "2025",
    semester_number: "2",
    course_title: "MATH",
    course_number: "102",
    grade: "B",
    credit_hours: "3",
    grade_points: "9",
    sheet_gpa: "3.00",
    flags: "",
    notes: "",
    ...o,
  };
  return [v.source_file, v.page, v.sheet_no, v.student_id, v.student_name, "", "", "", "", v.sheet_year, "", v.semester_number, v.course_title, v.course_number, "1", v.grade, v.credit_hours, v.grade_points, v.sheet_gpa, v.flags, v.notes]
    .map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x))
    .join(",");
}

function ctx(over: Partial<ImportContext> = {}): ImportContext {
  const g = (gp: string | null, counts = true) => ({ gradePoint: gp, countsInGpa: counts });
  return {
    letters: new Map([
      ["A+", g("4.00")],
      ["B+", g("3.30")],
      ["F", g("0.00")],
      ["I", g(null, false)],
      ["A", g("4.00")],
      ["B", g("3.00")],
      ["C", g("2.00")],
      ["D", g("1.00")],
    ]),
    students: new Map([
      ["2024853", { id: "s1", firstName: "Abraham", middleName: "B.", lastName: "Coleman", enrolmentYear: 2024 }],
      ["2022851", { id: "s2", firstName: "Joseph", middleName: null, lastName: "Boimah", enrolmentYear: 2022 }],
    ]),
    semesters: new Map([
      ["2024/2025|2", { id: "sem-2425-2", label: "2024/2025 — Semester II", hasEnded: true, startYear: 2025, sortKey: 20242 }],
      ["2025/2026|1", { id: "sem-2526-1", label: "2025/2026 — Semester I", hasEnded: true, startYear: 2025, sortKey: 20251 }],
      ["2025/2026|2", { id: "sem-2526-2", label: "2025/2026 — Semester II", hasEnded: false, startYear: 2026, sortKey: 20252 }],
    ]),
    courses: [
      { code: "MATH102", title: "College Mathematics II" },
      { code: "ENGL102", title: "Freshman English II" },
      { code: "FREN102", title: "French" },
      { code: "CECS102", title: "Christian Service" },
    ],
    existing: new Map(),
    calendar: [
      { label: "2024/2025", startDate: "2024-09-01", endDate: "2025-07-31", semesters: [{ sequence: 2, startDate: "2025-02-03", endDate: "2025-06-27" }] },
      {
        label: "2025/2026",
        startDate: "2025-09-01",
        endDate: "2026-07-31",
        semesters: [
          { sequence: 1, startDate: "2025-09-08", endDate: "2026-01-23" },
          { sequence: 2, startDate: "2026-02-02", endDate: "2026-06-26" },
        ],
      },
    ],
    today: new Date("2026-06-01"),
    ...over,
  };
}

const only = (text: string, c = ctx()) => {
  const a = analyseGradeSheetCsv(text, c);
  expect(a.fileProblem).toBeNull();
  return a.sheets[0];
};

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "line\nbreak"],
    ]);
  });
});

describe("academic year", () => {
  it("reads a full academic year as itself", () => {
    expect(academicYearFor("2025/2026", 1)).toEqual({ label: "2025/2026" });
  });
  it("reads Year 2025 Semester II as 2024/2025, as the College decided", () => {
    expect(academicYearFor("2025", 2)).toEqual({ label: "2024/2025" });
  });
  it("does not guess a bare year with Semester I", () => {
    expect(academicYearFor("2025", 1)).toHaveProperty("problem");
  });
  it("rejects a range that is not one year apart", () => {
    expect(academicYearFor("2025/2027", 1)).toHaveProperty("problem");
  });
});

describe("names", () => {
  it("accepts the record's name with middle initials and one slip in a long name", () => {
    expect(namesMatch({ firstName: "Abraham", lastName: "Coleman" }, "Abraham B. Colema")).toBe(true);
    expect(namesMatch({ firstName: "Othello", lastName: "Nagbe" }, "Othello W. Nagbe Jr")).toBe(true);
  });
  it("rejects a different person", () => {
    expect(namesMatch({ firstName: "Levi", lastName: "Brown" }, "James K. Kerkulah")).toBe(false);
    expect(namesMatch({ firstName: "Lady", lastName: "Kofi" }, "Mary Kofi")).toBe(false);
  });
  it("never matches on a name with nothing to compare", () => {
    expect(namesMatch({ firstName: "G", lastName: "P" }, "Abraham B Coleman")).toBe(false);
  });
  it("links spellings of one person but not two people who share a surname", () => {
    expect(mayBeSamePerson("Alphonso Zoe", "Zeo Alphoso")).toBe(true);
    expect(mayBeSamePerson("Ram L. Blackie", "Ram L Blackie")).toBe(true);
    expect(mayBeSamePerson("Lady Kofi", "Mary Kofi")).toBe(false);
    expect(mayBeSamePerson("James Kerkulah", "Wilmot Kerkulah")).toBe(false);
  });
});

describe("a clean sheet", () => {
  it("is ready, mapped to the catalogue and to 2024/2025 Semester II", () => {
    const s = only(
      csv(
        row({ grade: "A", grade_points: "12", sheet_gpa: "3.50" }),
        row({ course_title: "French", grade: "B", grade_points: "9", sheet_gpa: "3.50" }),
      ),
    );
    expect(s.problems).toEqual([]);
    expect(s.status).toBe("ready");
    expect(s.semester?.id).toBe("sem-2425-2");
    expect(s.courses.map((c) => [c.code, c.letter, c.creditHours])).toEqual([
      ["MATH102", "A", 3],
      ["FREN102", "B", 3],
    ]);
  });

  it("allows the 0.01 the sheets lose by cutting off instead of rounding", () => {
    // (9 + 9 + 12 + 1.5) / 9.5 = 3.3157... printed as 3.31
    const s = only(
      csv(
        row({ sheet_gpa: "3.31" }),
        row({ course_title: "ENGL", sheet_gpa: "3.31" }),
        row({ course_title: "French", grade: "A", grade_points: "12", sheet_gpa: "3.31" }),
        row({ course_title: "CECS", grade: "B", credit_hours: "0.5", grade_points: "1.5", sheet_gpa: "3.31" }),
      ),
    );
    expect(s.status).toBe("ready");
  });

  it("keeps an Incomplete with no grade points, out of the GPA", () => {
    const s = only(csv(row({ sheet_gpa: "3.00" }), row({ course_title: "ENGL", grade: "I", grade_points: "-", sheet_gpa: "3.00" })));
    expect(s.status).toBe("ready");
  });
});

describe("what holds a sheet back", () => {
  const blocked = (text: string, match: RegExp, c = ctx()) => {
    const s = only(text, c);
    expect(s.status).toBe("blocked");
    expect(s.problems.join(" | ")).toMatch(match);
  };

  it("a grade that disagrees with its points (Joseph Boimah's Christian Ethics)", () =>
    blocked(
      csv(row({ student_id: "2022851", student_name: "Joseph Boimah", grade: "A", credit_hours: "2", grade_points: "6", sheet_gpa: "3.00" })),
      /A × 2 hours = 8 points, but the sheet shows 6/,
    ));

  it("a printed GPA the grades do not give", () => blocked(csv(row({ sheet_gpa: "3.63" })), /printed GPA is 3.63.*give 3.00/));

  it("a grade the system does not have (NG)", () => blocked(csv(row({ grade: "NG", grade_points: "" })), /"NG" is not a grade/));

  it("a Student ID the system does not have", () => blocked(csv(row({ student_id: "20248615" })), /No student with ID 20248615/));

  it("a missing Student ID", () => blocked(csv(row({ student_id: "" })), /No Student ID/));

  it("an ID that belongs to someone else", () =>
    blocked(csv(row({ student_id: "2022851" })), /belongs to Joseph Boimah, but this sheet is for "Abraham B Coleman"/));

  it("a name that fits two records (a student enrolled twice)", () => {
    const c = ctx();
    c.students.set("2024999", { id: "s9", firstName: "Abraham", middleName: null, lastName: "Coleman", enrolmentYear: 2024 });
    blocked(csv(row()), /also matches Abraham Coleman \(ID 2024999\)/, c);
  });

  it("an ID printed for two different people in the same semester: neither goes in", () => {
    const c = ctx();
    const a = analyseGradeSheetCsv(csv(row(), row({ sheet_no: "2", student_name: "Joseph Boimah", course_title: "ENGL" })), c);
    expect(a.sheets.map((x) => x.status)).toEqual(["blocked", "blocked"]);
    for (const x of a.sheets) expect(x.problems.join(" ")).toMatch(/ID 2024853 is printed for "Abraham B Coleman" and "Joseph Boimah" in 2024\/2025 — Semester II.*Neither is imported/);
  });

  it("an ID used by someone else in another semester: only that sheet is held, with its semester", () => {
    const a = analyseGradeSheetCsv(
      csv(row(), row({ sheet_no: "2", student_name: "Joseph Boimah", sheet_year: "2025/2026", semester_number: "1", sheet_gpa: "3.00" })),
      ctx(),
    );
    expect(a.sheets.map((x) => x.status)).toEqual(["ready", "blocked"]);
    expect(a.sheets[1].semesterWanted).toBe("2025/2026 — Semester I");
    expect(a.sheets[1].problems.join(" ")).toMatch(/belongs to Abraham B\. Coleman, but this sheet is for "Joseph Boimah"/);
  });

  it("the same person under two IDs in the file", () => {
    const c = ctx();
    c.students.set("2024999", { id: "s9", firstName: "Abrahim", middleName: null, lastName: "Colman", enrolmentYear: 2024 });
    const a = analyseGradeSheetCsv(
      csv(row(), row({ sheet_no: "2", student_id: "2024999", student_name: "Abrahim Colman", sheet_year: "2025/2026", semester_number: "1" })),
      c,
    );
    expect(a.sheets.every((s) => s.status === "blocked")).toBe(true);
    expect(a.sheets[0].problems.join(" ")).toMatch(/looks like the same student/);
  });

  it("the same student and semester on two sheets", () => {
    const a = analyseGradeSheetCsv(csv(row(), row({ sheet_no: "2" })), ctx());
    expect(a.sheets.map((s) => s.status)).toEqual(["blocked", "blocked"]);
    expect(a.sheets[0].problems.join(" ")).toMatch(/on 2 sheets/);
  });

  it("the same course twice on one sheet", () => blocked(csv(row(), row()), /already on this sheet/));

  it("a corrected code (course_code column) the catalogue does not have", () => {
    const text = [HEADER + ",course_code", row() + ",ZZZZ999"].join("\n");
    blocked(text, /ZZZZ999 is not in the course catalogue/);
  });

  it("a title two catalogue courses share at the same number", () =>
    blocked(
      csv(row({ course_title: "Christian Service" })),
      /CECS102 and CECX102 both match "Christian Service 102"/,
      ctx({ courses: [...ctx().courses, { code: "CECX102", title: "Christian Service" }] }),
    ));

  it("an extraction flag nobody has cleared", () =>
    blocked(csv(row({ flags: "UNREADABLE", notes: "smudged" })), /flagged UNREADABLE \(smudged\)/));

  it("a semester not yet ended", () =>
    blocked(csv(row({ sheet_year: "2025/2026", semester_number: "2" })), /has not ended yet/));

  it("a semester not in the calendar, with no year to copy its dates from", () =>
    blocked(csv(row({ sheet_year: "2023/2024", semester_number: "1" })), /2023\/2024 — Semester I does not exist.*no other year has a Semester I/, ctx({ calendar: [] })));

  it("half-hours only", () => blocked(csv(row({ credit_hours: "0.3", grade_points: "0.9" })), /not a valid number of hours/));

  it("a sheet with no courses", () =>
    blocked(csv(row({ course_title: "", course_number: "", grade: "", credit_hours: "", grade_points: "" })), /no courses/));

  it("a course already on record for that semester (a second import)", () =>
    blocked(
      csv(row()),
      /already on this student's record for 2024\/2025 — Semester II/,
      ctx({ existing: new Map([["s1", [{ semesterId: "sem-2425-2", codeKey: "math102", letter: "B" }]]]) }),
    ));

  it("a file without the required columns", () => {
    expect(analyseGradeSheetCsv("student_id,grade\n1,A", ctx()).fileProblem).toMatch(/missing required columns/);
  });
});

describe("the Student ID the system holds", () => {
  it("settles a blank or unknown ID from the student's other sheets, when the system has exactly that ID for them", () => {
    const a = analyseGradeSheetCsv(
      csv(
        row(),
        row({ sheet_no: "2", student_id: "", student_name: "Abraham B. Colema", sheet_year: "2025/2026", semester_number: "1" }),
        row({ sheet_no: "3", student_id: "20248530", student_name: "Abraham Coleman", sheet_year: "2025/2026", semester_number: "2" }),
      ),
      ctx({ today: new Date("2026-09-29") }),
    );
    expect(a.sheets[1].status).toBe("ready");
    expect(a.sheets[1].studentNumber).toBe("2024853");
    expect(a.sheets[1].idNote).toMatch(/no Student ID.*goes in under 2024853/);
    expect(a.sheets[2].studentNumber).toBe("2024853");
    expect(a.sheets[2].idNote).toMatch(/says ID 20248530, which is not in the system/);
  });

  it("does not settle an unknown ID that no other sheet in the file links to the system's record", () => {
    const s = only(csv(row({ student_id: "2024999" })));
    expect(s.status).toBe("blocked");
    expect(s.idNote).toBeNull();
    expect(s.problems.join(" ")).toMatch(/No student with ID 2024999/);
  });
});

describe("a past semester missing from the calendar", () => {
  it("is created with the dates of the nearest year's same semester, moved by whole years", () => {
    const c = ctx();
    const plan = planPastSemester("2023/2024", 2, c.calendar, c.today);
    expect(plan).toEqual({
      plan: {
        key: "2023/2024|2",
        yearLabel: "2023/2024",
        newYear: { startDate: "2023-09-01", endDate: "2024-07-31" },
        sequence: 2,
        name: "Semester II",
        startDate: "2024-02-03",
        endDate: "2024-06-27",
      },
    });
  });

  it("goes into an existing year without re-creating it", () => {
    const c = ctx();
    const plan = planPastSemester("2024/2025", 1, c.calendar, c.today);
    expect(plan).toEqual({
      plan: { key: "2024/2025|1", yearLabel: "2024/2025", newYear: null, sequence: 1, name: "Semester I", startDate: "2024-09-08", endDate: "2025-01-23" },
    });
  });

  it("is not created when it would not have ended yet", () => {
    const c = ctx();
    expect(planPastSemester("2026/2027", 1, c.calendar, c.today)).toHaveProperty("problem");
  });

  it("makes the sheet ready, marked to be created", () => {
    const s = only(csv(row({ sheet_year: "2023/2024", semester_number: "2", student_id: "2022851", student_name: "Joseph Boimah" })));
    expect(s.problems).toEqual([]);
    expect(s.semester).toMatchObject({ id: null, label: "2023/2024 — Semester II", create: { startDate: "2024-02-03", endDate: "2024-06-27" } });
  });
});

describe("older-curriculum courses the catalogue does not hold", () => {
  it("go in exactly as the sheet prints them, marked not in the catalogue", () => {
    const s = only(
      csv(
        row({ course_title: "CHRS", course_number: "102", grade: "B", credit_hours: "1", grade_points: "3", sheet_gpa: "3.00" }),
        row({ course_title: "Military Science", grade: "B", credit_hours: "1", grade_points: "3", sheet_gpa: "3.00" }),
        row({ course_title: "French", grade: "B", sheet_gpa: "3.00" }),
      ),
    );
    expect(s.problems).toEqual([]);
    expect(s.courses.map((c) => [c.code, c.title, c.inCatalogue])).toEqual([
      ["CHRS102", "CHRS 102", false],
      ["MILITARY SCIENCE 102", "Military Science", false],
      ["FREN102", "French", true],
    ]);
  });
});

describe("repeats", () => {
  it("marks a course taken in an earlier semester as a repeat, for confirmation", () => {
    const s = only(csv(row()), ctx({ existing: new Map([["s1", [{ semesterId: "older", codeKey: "math102", letter: "F" }]]]) }));
    expect(s.status).toBe("ready");
    expect(s.courses[0].repeatOf).toMatch(/already on record \(grade F\)/);
  });
});
