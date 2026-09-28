import { describe, expect, it } from "vitest";
import {
  buildSemesterResults,
  courseGradesCsv,
  enteredViaLabel,
  exportFileSlug,
  semesterResultsCsv,
  standingLabel,
  type CourseGradeRow,
  type ResultStudent,
  type StudentEngineRecord,
} from "../semesterExportRows";

const Y2024_S1 = { yearStart: 2024, sequence: 1 as const };
const Y2024_S2 = { yearStart: 2024, sequence: 2 as const };
const Y2025_S1 = { yearStart: 2025, sequence: 1 as const };

let nextId = 0;
function rec(
  studentId: string,
  semesterId: string,
  sortKey: { yearStart: number; sequence: 1 | 2 },
  code: string,
  letter: string,
  gradePoint: string | null,
  credits = "3.0",
): StudentEngineRecord {
  const earns = gradePoint !== null && Number(gradePoint) >= 0.7;
  return {
    id: `r${++nextId}`,
    studentId,
    semesterId,
    semesterSortKey: sortKey,
    courseCodeKey: code,
    creditHours: credits,
    gradePoint,
    countsInGpa: gradePoint !== null,
    countsInAttempted: gradePoint !== null,
    countsInEarned: earns,
    wasMajorAtRecord: false,
    letter,
  };
}

const student = (id: string, lastName: string, extra: Partial<ResultStudent> = {}): ResultStudent => ({
  id,
  studentNumber: `2024${id.padStart(4, "0")}`,
  firstName: "Test",
  middleName: null,
  lastName,
  college: "College of Health Sciences",
  department: "Nursing",
  isProvisional: false,
  ...extra,
});

const target = (semesterId: string, sortKey: { yearStart: number; sequence: 1 | 2 }) => ({
  semesterId,
  sortKey,
  yearLabel: `${sortKey.yearStart}/${sortKey.yearStart + 1}`,
  semesterName: sortKey.sequence === 1 ? "Semester I" : "Semester II",
});

describe("export file naming", () => {
  it("puts the year in the file name, so two years never save over each other", () => {
    expect(exportFileSlug("2025/2026", "Semester I")).toBe("2025-2026-semester-i");
    expect(exportFileSlug("2024/2025", "Semester I")).not.toBe(exportFileSlug("2025/2026", "Semester I"));
    expect(exportFileSlug("2025/2026", "Semester II")).toBe("2025-2026-semester-ii");
  });
});

describe("semester results", () => {
  it("counts CGPA only up to the end of the semester being exported", () => {
    const records = [
      rec("1", "A", Y2024_S1, "BIO101", "A", "4.00"),
      rec("1", "B", Y2024_S2, "CHE101", "C+", "2.30"),
      // A later semester must not move last year's figures.
      rec("1", "C", Y2025_S1, "PHY101", "F", "0.00"),
    ];
    const [row] = buildSemesterResults(target("B", Y2024_S2), [student("1", "Kollie")], records);

    expect(row.semesterGpa).toBe("2.300");
    expect(row.cgpa).toBe("3.150"); // (4.00*3 + 2.30*3) / 6, not including the later F
    expect(row.cumulativeCreditsEarned).toBe("6.0");
    expect(row.standing).toBe("Good standing");
  });

  it("resolves a repeat within that history only", () => {
    const records = [
      rec("1", "A", Y2024_S1, "MTH101", "F", "0.00"),
      rec("1", "B", Y2024_S2, "MTH101", "B+", "3.30"),
      rec("1", "C", Y2025_S1, "MTH101", "A", "4.00"),
    ];
    // At the end of Semester II 2024, the B+ replaced the F -- the later A
    // did not exist yet.
    const [row] = buildSemesterResults(target("B", Y2024_S2), [student("1", "Kollie")], records);
    expect(row.cgpa).toBe("3.300");
    expect(row.standing).toBe("Good standing");
  });

  it("gives standing from the displayed CGPA and withholds it when history is provisional", () => {
    const honours = [rec("1", "A", Y2024_S1, "BIO101", "A", "4.00")];
    const probation = [rec("2", "A", Y2024_S1, "BIO101", "D-", "0.70")];
    const provisional = [rec("3", "A", Y2024_S1, "BIO101", "A", "4.00")];
    const rows = buildSemesterResults(
      target("A", Y2024_S1),
      [student("1", "Alpha"), student("2", "Bravo"), student("3", "Charlie", { isProvisional: true })],
      [...honours, ...probation, ...provisional],
    );
    expect(rows.map((r) => r.standing)).toEqual(["Honours", "Probation", "Provisional"]);
  });

  it("includes only students with a record in the semester, sorted by name", () => {
    const records = [
      rec("1", "A", Y2024_S1, "BIO101", "A", "4.00"),
      rec("2", "A", Y2024_S1, "BIO101", "B", "3.00"),
      rec("3", "B", Y2024_S2, "BIO101", "B", "3.00"),
    ];
    const rows = buildSemesterResults(
      target("A", Y2024_S1),
      [student("1", "Zeon"), student("2", "Appleton"), student("3", "Mensah")],
      records,
    );
    expect(rows.map((r) => r.lastName)).toEqual(["Appleton", "Zeon"]);
    expect(rows[0]).toMatchObject({ academicYear: "2024/2025", semester: "Semester I", courses: "1" });
  });

  it("leaves the GPA blank rather than inventing one for a semester of Incompletes", () => {
    const [row] = buildSemesterResults(
      target("A", Y2024_S1),
      [student("1", "Kollie")],
      [rec("1", "A", Y2024_S1, "BIO101", "I", null)],
    );
    expect(row.semesterGpa).toBe("");
    expect(row.cgpa).toBe("");
    expect(row.standing).toBe("");
  });
});

describe("labels", () => {
  it("says where a record came from in the office's words", () => {
    expect(enteredViaLabel("SYSTEM")).toBe("Portal");
    expect(enteredViaLabel("IMPORTED")).toBe("Historical entry");
  });

  it("marks a provisional record rather than leaving the standing blank", () => {
    expect(standingLabel(null, true)).toBe("Provisional");
    expect(standingLabel(null, false)).toBe("");
    expect(standingLabel("PROBATION", false)).toBe("Probation");
  });
});

describe("CSV", () => {
  const gradeRow: CourseGradeRow = {
    studentNumber: "20241047",
    lastName: "Doe-Kpan",
    firstName: "Comfort",
    middleName: "",
    college: "College of Education",
    department: "Early Childhood, Primary",
    academicYear: "2025/2026",
    semester: "Semester I",
    courseCode: "EDU 101",
    courseTitle: "=HYPERLINK(\"x\")",
    creditHours: "3.0",
    grade: "B+",
    gradePoint: "3.30",
    attempt: "1",
    enteredVia: "Portal",
    repeatExcluded: "No",
    void: "No",
  };

  it("starts with a byte-order mark so Excel reads names correctly", () => {
    expect(courseGradesCsv([gradeRow]).charCodeAt(0)).toBe(0xfeff);
    expect(semesterResultsCsv([]).charCodeAt(0)).toBe(0xfeff);
  });

  it("names the year and semester in their own columns", () => {
    const [header, line] = courseGradesCsv([gradeRow]).slice(1).split("\r\n");
    const headers = header.split(",");
    expect(headers).toContain("Academic Year");
    expect(headers).toContain("Semester");
    expect(line).toContain("2025/2026,Semester I");
  });

  it("quotes commas and neutralises formulas", () => {
    const csv = courseGradesCsv([gradeRow]);
    expect(csv).toContain('"Early Childhood, Primary"');
    expect(csv).not.toContain(",=HYPERLINK");
  });
});
