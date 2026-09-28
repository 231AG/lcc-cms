import { csvCell } from "@/lib/export/csvCell";
import { listName } from "@/lib/students/name";
import {
  DEFAULT_GPA_POLICY,
  computeCumulativeSummary,
  computeSemesterSummary,
  deriveAcademicStanding,
  formatGpa,
  resolveRepeats,
  type AcademicStanding,
  type EngineRecord,
  type GpaPolicy,
  type SemesterSortKey,
} from "@/lib/gpa/engine";

/**
 * The two semester-end export files, as rows and as CSV text.
 *
 * Pure: no database, no actor, no audit. The loaders in academicExport.ts
 * fetch the data and hand it here, so everything a registrar would dispute
 * -- which semester a file says it is, what a column is called, how a
 * CGPA "as at the end of that semester" is worked out -- is covered by
 * plain unit tests against fixed inputs.
 */

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** "2025-2026-semester-i": the year and semester, safe for a file name.
 *  The year is what the old file names were missing -- two years' "First
 *  Semester" downloads saved over each other. */
export function exportFileSlug(yearLabel: string, semesterName: string): string {
  return `${yearLabel} ${semesterName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// File 1: course grades -- one row per student per course
// ---------------------------------------------------------------------------

export interface CourseGradeRow {
  [column: string]: string;
  studentNumber: string;
  lastName: string;
  firstName: string;
  middleName: string;
  college: string;
  department: string;
  academicYear: string;
  semester: string;
  courseCode: string;
  courseTitle: string;
  creditHours: string;
  grade: string;
  gradePoint: string;
  attempt: string;
  enteredVia: string;
  repeatExcluded: string;
  void: string;
}

export const COURSE_GRADE_COLUMNS = [
  { key: "studentNumber", header: "Student ID" },
  { key: "lastName", header: "Last Name" },
  { key: "firstName", header: "First Name" },
  { key: "middleName", header: "Middle Name" },
  { key: "college", header: "College" },
  { key: "department", header: "Department" },
  { key: "academicYear", header: "Academic Year" },
  { key: "semester", header: "Semester" },
  { key: "courseCode", header: "Course Code" },
  { key: "courseTitle", header: "Course Title" },
  { key: "creditHours", header: "Credit Hours" },
  { key: "grade", header: "Grade" },
  { key: "gradePoint", header: "Grade Point" },
  { key: "attempt", header: "Attempt" },
  { key: "enteredVia", header: "Entered Via" },
  { key: "repeatExcluded", header: "Replaced by a Later Attempt" },
  { key: "void", header: "Void" },
] as const satisfies ReadonlyArray<{ key: keyof CourseGradeRow; header: string }>;

/** How a record reached the academic record, in the office's words rather
 *  than the column's (SYSTEM / IMPORTED). */
export function enteredViaLabel(origin: string): string {
  if (origin === "SYSTEM") return "Portal";
  if (origin === "IMPORTED") return "Historical entry";
  return origin;
}

export const yesNo = (value: boolean) => (value ? "Yes" : "No");

// ---------------------------------------------------------------------------
// File 2: semester results -- one row per student
// ---------------------------------------------------------------------------

export interface SemesterResultRow {
  [column: string]: string;
  studentNumber: string;
  lastName: string;
  firstName: string;
  middleName: string;
  college: string;
  department: string;
  academicYear: string;
  semester: string;
  courses: string;
  creditsAttempted: string;
  creditsEarned: string;
  semesterGpa: string;
  cumulativeCreditsEarned: string;
  cgpa: string;
  standing: string;
}

export const SEMESTER_RESULT_COLUMNS = [
  { key: "studentNumber", header: "Student ID" },
  { key: "lastName", header: "Last Name" },
  { key: "firstName", header: "First Name" },
  { key: "middleName", header: "Middle Name" },
  { key: "college", header: "College" },
  { key: "department", header: "Department" },
  { key: "academicYear", header: "Academic Year" },
  { key: "semester", header: "Semester" },
  { key: "courses", header: "Courses" },
  { key: "creditsAttempted", header: "Credits Attempted" },
  { key: "creditsEarned", header: "Credits Earned" },
  { key: "semesterGpa", header: "Semester GPA" },
  { key: "cumulativeCreditsEarned", header: "Cumulative Credits Earned" },
  { key: "cgpa", header: "CGPA" },
  { key: "standing", header: "Standing" },
] as const satisfies ReadonlyArray<{ key: keyof SemesterResultRow; header: string }>;

const STANDING_LABEL: Record<Exclude<AcademicStanding, null>, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * The standing cell. A student whose earlier history has not been fully
 * entered gets "Provisional" rather than a label: the engine withholds
 * standing from a provisional CGPA (F-44b), and a blank cell would read as
 * a missing value rather than as a deliberate "not yet".
 */
export function standingLabel(standing: AcademicStanding, isProvisional: boolean): string {
  if (standing) return STANDING_LABEL[standing];
  return isProvisional ? "Provisional" : "";
}

export interface ResultStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  college: string;
  department: string;
  /** Earlier history not yet fully entered -- see standingLabel. */
  isProvisional: boolean;
}

export type StudentEngineRecord = EngineRecord & { studentId: string };

function atOrBefore(a: SemesterSortKey, b: SemesterSortKey): boolean {
  return a.yearStart !== b.yearStart ? a.yearStart < b.yearStart : a.sequence <= b.sequence;
}

/**
 * One row per student with at least one (non-void) record in the target
 * semester.
 *
 * The CGPA is worked out AS AT THE END OF THAT SEMESTER: only the student's
 * records from that semester and earlier are counted, and repeats are
 * resolved within that history alone. The stored cumulative summary is
 * today's figure, so reading it for last year's file would print a CGPA the
 * student did not have then -- and a standing that may not have applied.
 *
 * The semester GPA is the engine's own (computeSemesterSummary), which is
 * exactly what student_semester_summary stores: a semester GPA never
 * changes because of what happened later.
 *
 * `records` must be every non-void record these students hold, in every
 * semester; this function does the date cut itself.
 */
export function buildSemesterResults(
  target: { semesterId: string; sortKey: SemesterSortKey; yearLabel: string; semesterName: string },
  students: ResultStudent[],
  records: StudentEngineRecord[],
  policy: GpaPolicy = DEFAULT_GPA_POLICY,
): SemesterResultRow[] {
  const byStudent = new Map<string, StudentEngineRecord[]>();
  for (const r of records) {
    const list = byStudent.get(r.studentId);
    if (list) list.push(r);
    else byStudent.set(r.studentId, [r]);
  }

  const rows: SemesterResultRow[] = [];
  for (const s of students) {
    const own = byStudent.get(s.id) ?? [];
    const inSemester = own.filter((r) => r.semesterId === target.semesterId);
    if (inSemester.length === 0) continue;

    const history = own.filter((r) => atOrBefore(r.semesterSortKey, target.sortKey));
    const semesterSummary = computeSemesterSummary(inSemester);
    const cumulative = computeCumulativeSummary(history, resolveRepeats(history));
    const cgpa = formatGpa(cumulative.cgpa);
    const standing = deriveAcademicStanding(cgpa, s.isProvisional, policy);

    rows.push({
      studentNumber: s.studentNumber,
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName ?? "",
      college: s.college,
      department: s.department,
      academicYear: target.yearLabel,
      semester: target.semesterName,
      courses: String(inSemester.length),
      creditsAttempted: semesterSummary.creditsAttempted,
      creditsEarned: semesterSummary.creditsEarned,
      semesterGpa: formatGpa(semesterSummary.gpa) ?? "",
      cumulativeCreditsEarned: cumulative.totalCreditsEarned,
      cgpa: cgpa ?? "",
      standing: standingLabel(standing, s.isProvisional),
    });
  }

  return rows.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.studentNumber.localeCompare(b.studentNumber),
  );
}

// ---------------------------------------------------------------------------
// The printed results sheet
// ---------------------------------------------------------------------------

/** The printed sheet is read across a page, not filtered like the CSV, so
 *  it carries one Name column and leaves College out: the department
 *  already says where each student sits. */
export const SEMESTER_RESULT_PRINT_COLUMNS = [
  { key: "studentNumber", header: "Student ID", nowrap: true },
  { key: "name", header: "Name" },
  { key: "department", header: "Department" },
  { key: "courses", header: "Courses", nowrap: true },
  { key: "creditsAttempted", header: "Cr. attempted", nowrap: true },
  { key: "creditsEarned", header: "Cr. earned", nowrap: true },
  { key: "semesterGpa", header: "Semester GPA", nowrap: true },
  { key: "cumulativeCreditsEarned", header: "Total cr. earned", nowrap: true },
  { key: "cgpa", header: "CGPA", nowrap: true },
  { key: "standing", header: "Standing", nowrap: true },
];

export function semesterResultPrintRows(rows: SemesterResultRow[]): Array<SemesterResultRow & { name: string }> {
  return rows.map((r) => ({
    ...r,
    name: listName({ firstName: r.firstName, middleName: r.middleName || null, lastName: r.lastName }),
  }));
}

/** The line under the printed table: what the CGPA means, and -- when it
 *  applies -- that the sheet is not final yet. */
export function semesterResultsFootNote(unpublishedCount: number): string {
  const notes = ["CGPA and standing are as at the end of this semester"];
  if (unpublishedCount > 0) {
    notes.push(
      `${unpublishedCount} registered ${unpublishedCount === 1 ? "student has" : "students have"} no published grade yet, so these results are not final`,
    );
  }
  return notes.join(" · ");
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A byte-order mark first. Without it Excel on Windows opens a UTF-8 CSV
 * as the local code page and turns any accented name into mojibake; with
 * it, Excel, LibreOffice and Google Sheets all read the file correctly.
 */
const BOM = "﻿";

function toCsv<Row extends Record<string, string>>(
  columns: ReadonlyArray<{ key: keyof Row & string; header: string }>,
  rows: Row[],
): string {
  const header = columns.map((c) => csvCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return BOM + [header, ...lines].join("\r\n") + "\r\n";
}

export const courseGradesCsv = (rows: CourseGradeRow[]) => toCsv(COURSE_GRADE_COLUMNS, rows);
export const semesterResultsCsv = (rows: SemesterResultRow[]) => toCsv(SEMESTER_RESULT_COLUMNS, rows);
