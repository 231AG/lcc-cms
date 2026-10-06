import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicRecord,
  academicYear,
  college as collegeTable,
  course,
  department as departmentTable,
  semester,
  student,
  studentSemesterSummary,
  studentCumulativeSummary,
} from "@/lib/db/schema";
import { checkManualEntry, saveManualEntry, type ManualEntryInput } from "../manualEntry";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Past grades entered by hand: a catalogue course is found however its
 * code is typed, points come from the grade and hours, the paper's own
 * arithmetic and hours that differ from the catalogue must be confirmed,
 * a course can be added to the catalogue or recorded as printed, a
 * missing past semester is created, and the record refuses a course twice
 * in one semester.
 *
 * Direct inserts with synthetic ids, like gradeSheetImport.integration.test.ts,
 * so this runs in CI without a Supabase project.
 */

const id = () => randomUUID();
const ADMIN = id(), STU = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const STUDENT_NO = `2017${String(Date.now() % 1000).padStart(3, "0")}`;
// A made-up past year, different on every run.
const Y0 = 1900 + ((Date.now() + 37) % 88);
const YEAR_LABEL = `${Y0}/${Y0 + 1}`;
// The following year, which the calendar does not hold: saving creates it.
const NEXT_LABEL = `${Y0 + 1}/${Y0 + 2}`;
const ACCT = `H${tag}101`;
const FREN = `J${tag}101`;
const NEW_CODE = `K${tag}110`;
const OLD_CODE = `W${tag}120`;
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;

const base = (over: Partial<ManualEntryInput> = {}): ManualEntryInput => ({
  studentId: STU,
  yearLabel: YEAR_LABEL,
  sequence: 2,
  rows: [],
  ...over,
});

describe("past grades entered by hand", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `man-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Mary", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `MN-${tag}`, name: "Manual College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `MAN${tag}`, name: "Manual Dept", isActive: true });
    await db.insert(student).values({
      id: STU, studentNumber: STUDENT_NO, firstName: "Mary", lastName: `Kofi${tag}`,
      departmentId: DEPT, enrolmentYear: Y0, historicalImportStatus: "NOT_STARTED", createdBy: ADMIN,
    });
    await db.insert(academicYear).values({ id: YEAR, label: YEAR_LABEL, startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-06-30`, isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 2, name: "Semester II", state: "CLOSED", startDate: `${Y0 + 1}-02-01`, endDate: `${Y0 + 1}-06-20` });
    await db.insert(course).values([
      { id: id(), departmentId: DEPT, code: ACCT, title: "Introduction to Accounting", creditHours: 3, isActive: true },
      { id: id(), departmentId: DEPT, code: FREN, title: "French I", creditHours: 3, isActive: true },
    ]);
  });

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, STU)));
    await quiet(db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, STU)));
    await quiet(db.delete(academicRecord).where(eq(academicRecord.studentId, STU)));
    await quiet(db.delete(course).where(inArray(course.code, [ACCT, FREN, NEW_CODE])));
    await quiet(db.delete(semester).where(eq(semester.id, SEM)));
    await quiet(db.delete(academicYear).where(eq(academicYear.id, YEAR)));
    const next = await db.query.academicYear.findFirst({ where: eq(academicYear.label, NEXT_LABEL) });
    if (next) {
      await quiet(db.delete(semester).where(eq(semester.academicYearId, next.id)));
      await quiet(db.delete(academicYear).where(eq(academicYear.id, next.id)));
    }
    // The student, department, college and users stay: the audit rows hold
    // RESTRICT keys to them. Harmless synthetic rows.
  });

  it("finds a catalogue course however the code is typed, and works out the points", async () => {
    const spaced = `${ACCT.slice(0, 4)} ${ACCT.slice(4)}`.toLowerCase();
    const c = await checkManualEntry(admin, base({ rows: [{ code: spaced, creditHours: 3, letter: "b" }] }));
    expect(c.problems).toEqual([]);
    expect(c.toConfirm).toEqual([]);
    expect(c.rows[0]).toMatchObject({ catalogue: "listed", title: "Introduction to Accounting", letter: "B", points: 9 });
    expect(c.totals).toMatchObject({ gpaHours: 3, points: 9, gpa: 3 });
    expect(c.semester).toMatchObject({ exists: true, willCreate: null });
  });

  it("asks to confirm points that disagree with the paper, and hours that differ from the catalogue", async () => {
    const c = await checkManualEntry(
      admin,
      base({
        rows: [
          { code: ACCT, creditHours: 3, letter: "A", paperPoints: 10 },
          { code: FREN, creditHours: 2, letter: "B", paperPoints: 6 },
        ],
        paperGpa: 3.4,
      }),
    );
    expect(c.problems).toEqual([]);
    expect(c.toConfirm).toHaveLength(3);
    expect(c.toConfirm[0]).toMatch(/paper shows 10 points, but A × 3 hours = 12/);
    expect(c.toConfirm[1]).toMatch(/2 credit hours entered; the catalogue lists 3/);
    expect(c.toConfirm[2]).toMatch(/GPA of 3.40, but these grades give 3.60/);
  });

  it("will not save until the points to check are confirmed", async () => {
    const input = base({ rows: [{ code: ACCT, creditHours: 3, letter: "A", paperPoints: 10 }] });
    await expect(saveManualEntry(admin, input)).rejects.toThrow(/tick the box/);
    expect(await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, STU) })).toEqual([]);
  });

  it("refuses a code the catalogue lacks until it is added or recorded as printed, and whole hours only for the catalogue", async () => {
    const missing = await checkManualEntry(admin, base({ rows: [{ code: NEW_CODE, creditHours: 3, letter: "B" }] }));
    expect(missing.problems[0]).toMatch(/not in the catalogue. Add it to the catalogue, or record it as printed/);

    const half = await checkManualEntry(
      admin,
      base({ rows: [{ code: NEW_CODE, creditHours: 0.5, letter: "B", newCourse: { mode: "catalogue", title: "Seminar", departmentId: DEPT } }] }),
    );
    expect(half.problems[0]).toMatch(/whole credit hours only/);
  });

  it("saves a semester: catalogue course, a course added to the catalogue, and one recorded as printed", async () => {
    const r = await saveManualEntry(
      admin,
      base({
        rows: [
          { code: ACCT, creditHours: 3, letter: "A", paperPoints: 12 },
          { code: NEW_CODE, creditHours: 2, letter: "B", newCourse: { mode: "catalogue", title: "Business Writing", departmentId: DEPT } },
          { code: OLD_CODE, creditHours: 0.5, letter: "A", newCourse: { mode: "asPrinted", title: "Military Science" } },
        ],
        paperGpa: 3.64,
      }),
    );
    expect(r).toMatchObject({ saved: 3, createdSemester: null });
    expect(r.createdCourses[0]).toMatch(/Business Writing \(2 hrs, Manual Dept\)/);

    const added = await db.query.course.findFirst({ where: eq(course.code, NEW_CODE) });
    expect(added).toMatchObject({ title: "Business Writing", creditHours: 2, departmentId: DEPT });

    const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, STU), orderBy: (t, { asc }) => asc(t.courseCodeSnapshot) });
    expect(records.map((x) => [x.courseCodeSnapshot, x.courseTitleSnapshot, x.letter, x.creditHours, x.courseId !== null])).toEqual([
      [ACCT, "Introduction to Accounting", "A", "3.0", true],
      [NEW_CODE, "Business Writing", "B", "2.0", true],
      [OLD_CODE, "Military Science", "A", "0.5", false],
    ]);
    expect(records[0].sourceNote).toMatch(/Entered by hand/);
    expect(records[2].sourceNote).toMatch(/recorded as printed/);

    // (12 + 6 + 2) / 5.5 = 3.636...
    const summary = await db.query.studentSemesterSummary.findFirst({ where: eq(studentSemesterSummary.studentId, STU) });
    expect(Number(summary?.gpa)).toBeCloseTo(3.636, 3);
  });

  it("refuses a course already on record for that semester, and marks one from an earlier semester as a repeat", async () => {
    const again = await checkManualEntry(admin, base({ rows: [{ code: ACCT, creditHours: 3, letter: "B" }] }));
    expect(again.problems[0]).toMatch(/already on record for .* \(grade A\)/);
    expect(again.semester.onRecord.map((r) => r.letter).sort()).toEqual(["A", "A", "B"]);

    const later = await checkManualEntry(admin, base({ yearLabel: NEXT_LABEL, rows: [{ code: ACCT, creditHours: 3, letter: "B" }] }));
    expect(later.problems).toEqual([]);
    expect(later.toConfirm[0]).toMatch(/already on the record .* grade A\), so this is saved as a repeat/);
  });

  it("creates a past semester the calendar lacks, with dates copied from the nearest year", async () => {
    const input = base({ yearLabel: NEXT_LABEL, rows: [{ code: FREN, creditHours: 3, letter: "C" }] });
    const c = await checkManualEntry(admin, input);
    expect(c.semester.exists).toBe(false);
    expect(c.semester.willCreate).toMatch(new RegExp(`${Y0 + 2}-02-01 to ${Y0 + 2}-06-20.*new academic year`));

    const r = await saveManualEntry(admin, input);
    expect(r.saved).toBe(1);
    const year = await db.query.academicYear.findFirst({ where: eq(academicYear.label, NEXT_LABEL) });
    expect(year).toBeTruthy();
    const sem = await db.query.semester.findFirst({ where: eq(semester.academicYearId, year!.id) });
    expect(sem).toMatchObject({ sequence: 2, state: "CLOSED" });
  });

  it("refuses a semester before the student enrolled", async () => {
    const c = await checkManualEntry(admin, base({ yearLabel: `${Y0 - 2}/${Y0 - 1}`, rows: [{ code: FREN, creditHours: 3, letter: "C" }] }));
    expect(c.problems.some((p) => /before .* enrolment year/.test(p))).toBe(true);
  });
});
