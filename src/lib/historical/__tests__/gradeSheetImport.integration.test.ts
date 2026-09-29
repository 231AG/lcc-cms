import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicRecord,
  academicYear,
  college as collegeTable,
  course,
  department as departmentTable,
  gradeScale,
  semester,
  student,
  studentSemesterSummary,
  studentCumulativeSummary,
} from "@/lib/db/schema";
import { commitGradeSheetImport, previewGradeSheetImport } from "../gradeSheetImport";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The grade-sheet import against a real database: the older plain letters
 * are in the scale, a clean sheet goes in whole through the same service
 * as a hand-typed record, half-hours survive, the same file imported
 * a second time is refused rather than doubled, and a past semester the
 * calendar lacks is created -- with an NG that counts nowhere.
 *
 * Direct inserts with synthetic ids, like enrolmentCounts.integration.test.ts,
 * so this runs in CI without a Supabase project.
 */

const id = () => randomUUID();
const ADMIN = id(), STU = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const STUDENT_NO = `2018${String(Date.now() % 1000).padStart(3, "0")}`;
// A made-up past year, different on every run, written the way the
// College writes one ("1953/1954").
const Y0 = 1900 + (Date.now() % 90);
const YEAR_LABEL = `${Y0}/${Y0 + 1}`;
// A surname no leftover from an earlier run can share: the importer
// refuses a name that fits two student records.
const SURNAME = `Coleman${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`;
const MATH = `Q${tag}102`;
const CECS = `Z${tag}102`;
const PREV_A = `Y${tag}201`;
const PREV_B = `Y${tag}202`;
// The year before, which the calendar doesn't hold: the import creates it.
const PREV_LABEL = `${Y0 - 1}/${Y0}`;
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;

const HEADER =
  "source_file,page,sheet_no,student_id,student_name,school,major,minor,class_level,sheet_year,semester_raw,semester_number,course_title,course_number,section,grade,credit_hours,grade_points,sheet_gpa,flags,notes";
// Printed GPA: (9 + 1.5) / 3.5 = 3.00. The year is written in full because
// the test semester sits in a made-up academic year.
const CSV = [
  HEADER,
  `sheets.pdf,1,1,${STUDENT_NO},Abraham B ${SURNAME},,,,,${YEAR_LABEL},Two,2,${MATH.replace(/\d+$/, "")},102,1,B,3,9,3.00,,`,
  `sheets.pdf,1,1,${STUDENT_NO},Abraham B ${SURNAME},,,,,${YEAR_LABEL},Two,2,Christian Service,102,1,B,0.5,1.5,3.00,,`,
].join("\n");

const CSV_PREV = [
  HEADER,
  `sheets.pdf,2,2,${STUDENT_NO},Abraham B ${SURNAME},,,,,${PREV_LABEL},Two,2,${PREV_A.replace(/\d+$/, "")},201,1,B,3,9,3.00,,`,
  `sheets.pdf,2,2,${STUDENT_NO},Abraham B ${SURNAME},,,,,${PREV_LABEL},Two,2,${PREV_B.replace(/\d+$/, "")},202,1,NG,2,-,3.00,,`,
].join("\n");

// A course of the older curriculum, printed as a title and number.
const CSV_OLD = [
  HEADER,
  `sheets.pdf,3,3,${STUDENT_NO},Abraham B ${SURNAME},,,,,${YEAR_LABEL},Two,2,Military Science,110,1,B,1,3,3.00,,`,
].join("\n");

describe("grade sheet import", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `imp-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Abraham", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `IM-${tag}`, name: "Import College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `IMP${tag}`, name: "Import Dept", isActive: true });
    await db.insert(student).values({
      id: STU, studentNumber: STUDENT_NO, firstName: "Abraham", middleName: "B.", lastName: SURNAME,
      departmentId: DEPT, enrolmentYear: Y0, historicalImportStatus: "NOT_STARTED", createdBy: ADMIN,
    });
    await db.insert(academicYear).values({ id: YEAR, label: YEAR_LABEL, startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-06-30`, isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 2, name: "Semester II", state: "CLOSED", startDate: `${Y0 + 1}-02-01`, endDate: `${Y0 + 1}-06-20` });
    await db.insert(course).values([
      { id: id(), departmentId: DEPT, code: MATH, title: "College Mathematics II", creditHours: 3, isActive: true },
      { id: id(), departmentId: DEPT, code: CECS, title: "Christian Service", creditHours: 1, isActive: true },
      { id: id(), departmentId: DEPT, code: PREV_A, title: "Earlier Course A", creditHours: 3, isActive: true },
      { id: id(), departmentId: DEPT, code: PREV_B, title: "Earlier Course B", creditHours: 2, isActive: true },
    ]);
  });

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, STU)));
    await quiet(db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, STU)));
    await quiet(db.delete(academicRecord).where(eq(academicRecord.studentId, STU)));
    await quiet(db.delete(course).where(inArray(course.code, [MATH, CECS, PREV_A, PREV_B])));
    await quiet(db.delete(semester).where(eq(semester.id, SEM)));
    await quiet(db.delete(academicYear).where(eq(academicYear.id, YEAR)));
    const prev = await db.query.academicYear.findFirst({ where: eq(academicYear.label, PREV_LABEL) });
    if (prev) {
      await quiet(db.delete(semester).where(eq(semester.academicYearId, prev.id)));
      await quiet(db.delete(academicYear).where(eq(academicYear.id, prev.id)));
    }
    // The student, department, college and users stay: the audit rows the
    // import writes hold RESTRICT keys to them. Harmless synthetic rows.
  });

  it("has the older plain letters in the scale, marked as older", async () => {
    const legacy = await db.query.gradeScale.findMany({ where: and(eq(gradeScale.isLegacy, true), eq(gradeScale.policyVersion, 1)) });
    expect(Object.fromEntries(legacy.map((r) => [r.letter, r.gradePoint]))).toEqual({ A: "4.00", B: "3.00", C: "2.00", D: "1.00" });
  });

  it("previews the sheet as ready, matched by code and by title", async () => {
    const a = await previewGradeSheetImport(admin, CSV);
    const s = a.sheets[0];
    expect(s.problems).toEqual([]);
    expect(s.status).toBe("ready");
    expect(s.courses.map((c) => c.code)).toEqual([MATH, CECS]);
  });

  it("imports it whole, keeping the plain B and the half hour", async () => {
    const r = await commitGradeSheetImport(admin, { text: CSV, fileName: "sheets.csv", confirmRepeats: false });
    expect(r.failed).toEqual([]);
    expect(r.imported).toHaveLength(1);

    const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, STU), orderBy: (t, { asc }) => asc(t.courseCodeSnapshot) });
    expect(records.map((x) => [x.courseCodeSnapshot, x.letter, x.gradePoint, x.creditHours, x.origin])).toEqual([
      [MATH, "B", "3.00", "3.0", "IMPORTED"],
      [CECS, "B", "3.00", "0.5", "IMPORTED"],
    ]);
    expect(records[0].sourceNote).toMatch(/sheets\.csv line 2/);

    const summary = await db.query.studentSemesterSummary.findFirst({ where: eq(studentSemesterSummary.studentId, STU) });
    expect(summary?.gpa).toBe("3.000000");
    const s = await db.query.student.findFirst({ where: eq(student.id, STU) });
    expect(s?.historicalImportStatus).toBe("IN_PROGRESS");
  });

  it("refuses the same file a second time instead of doubling it", async () => {
    const a = await previewGradeSheetImport(admin, CSV);
    expect(a.sheets[0].status).toBe("blocked");
    expect(a.sheets[0].problems.join(" ")).toMatch(/already on this student's record/);

    const r = await commitGradeSheetImport(admin, { text: CSV, fileName: "sheets.csv", confirmRepeats: false });
    expect(r.imported).toEqual([]);
    const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, STU) });
    expect(records).toHaveLength(2);
  });

  it("creates a past semester the calendar lacks, and keeps an NG out of the GPA", async () => {
    const a = await previewGradeSheetImport(admin, CSV_PREV);
    const s = a.sheets[0];
    expect(s.problems).toEqual([]);
    expect(s.semester).toMatchObject({ id: null, create: { yearLabel: PREV_LABEL, sequence: 2, newYear: { startDate: `${Y0 - 1}-09-01` } } });

    const r = await commitGradeSheetImport(admin, { text: CSV_PREV, fileName: "prev.csv", confirmRepeats: false });
    expect(r.failed).toEqual([]);
    expect(r.created).toHaveLength(1);
    const year = await db.query.academicYear.findFirst({ where: eq(academicYear.label, PREV_LABEL) });
    const sem = await db.query.semester.findFirst({ where: eq(semester.academicYearId, year!.id) });
    expect(sem).toMatchObject({ sequence: 2, state: "CLOSED", startDate: `${Y0}-02-01`, endDate: `${Y0}-06-20` });

    const ng = await db.query.academicRecord.findFirst({ where: and(eq(academicRecord.studentId, STU), eq(academicRecord.letter, "NG")) });
    expect(ng).toMatchObject({ gradePoint: null, countsInGpa: false, countsInAttempted: false, countsInEarned: false });
    const summary = await db.query.studentSemesterSummary.findFirst({
      where: and(eq(studentSemesterSummary.studentId, STU), eq(studentSemesterSummary.semesterId, sem!.id)),
    });
    expect(summary?.gpa).toBe("3.000000");
  });

  it("imports an older-curriculum course exactly as printed, and only once that is confirmed", async () => {
    const a = await previewGradeSheetImport(admin, CSV_OLD);
    expect(a.sheets[0].status).toBe("ready");
    expect(a.sheets[0].courses[0]).toMatchObject({ code: "MILITARY SCIENCE 110", title: "Military Science", inCatalogue: false });

    const held = await commitGradeSheetImport(admin, { text: CSV_OLD, fileName: "old.csv", confirmRepeats: false });
    expect(held.imported).toEqual([]);
    expect(held.heldForUncatalogued).toHaveLength(1);

    const r = await commitGradeSheetImport(admin, { text: CSV_OLD, fileName: "old.csv", confirmRepeats: false, confirmUncatalogued: true });
    expect(r.failed).toEqual([]);
    expect(r.imported).toHaveLength(1);
    const rec = await db.query.academicRecord.findFirst({
      where: and(eq(academicRecord.studentId, STU), eq(academicRecord.courseCodeSnapshot, "MILITARY SCIENCE 110")),
    });
    expect(rec).toMatchObject({ courseId: null, courseTitleSnapshot: "Military Science", letter: "B", creditHours: "1.0" });
  });
});
