import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  academicRecord,
  academicYear,
  appUser,
  college as collegeTable,
  course,
  department as departmentTable,
  semester,
  student,
  studentCumulativeSummary,
  studentSemesterSummary,
} from "@/lib/db/schema";
import { checkSemesterEdit, saveSemesterEdit, type SemesterEditInput } from "../semesterEdit";
import { recomputeStudentSummaries } from "@/lib/gpa/recompute";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The past-semester editor: a whole imported semester can be changed in one
 * go -- grades and hours edited, rows removed (voided) or added, a course
 * added to the catalogue -- with one reason, one transaction, and a check
 * that reports the GPA before and after without writing anything.
 */
const id = () => randomUUID();
const ADMIN = id(), STU = id(), COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id(), SEM2 = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const STUDENT_NO = `2015${String(Date.now() % 1000).padStart(3, "0")}`;
const Y0 = 1900 + ((Date.now() + 53) % 88);
const A = `SA${tag}101`, B = `SB${tag}101`, C = `SC${tag}101`, NEWC = `SN${tag}110`;
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;
const courseIds: Record<string, string> = {};

const live = () =>
  db.query.academicRecord.findMany({
    where: and(eq(academicRecord.studentId, STU), eq(academicRecord.semesterId, SEM), eq(academicRecord.isVoid, false)),
    orderBy: (t, { asc }) => asc(t.courseCodeSnapshot),
  });
const base = (rows: SemesterEditInput["rows"], over: Partial<SemesterEditInput> = {}): SemesterEditInput => ({
  studentId: STU,
  semesterId: SEM,
  rows,
  reason: "Corrected from the original paper sheet",
  ...over,
});

describe("past semester editor", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `se-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Eve", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `SE-${tag}`, name: "Edit College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `SED${tag}`, name: "Edit Dept", isActive: true });
    await db.insert(student).values({
      id: STU, studentNumber: STUDENT_NO, firstName: "Eve", lastName: `Edit${tag}`,
      departmentId: DEPT, enrolmentYear: Y0, historicalImportStatus: "IN_PROGRESS", createdBy: ADMIN,
    });
    await db.insert(academicYear).values({ id: YEAR, label: `${Y0}/${Y0 + 1}`, startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-06-30`, isCurrent: false });
    await db.insert(semester).values([
      { id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "CLOSED", startDate: `${Y0}-09-01`, endDate: `${Y0}-12-20` },
      { id: SEM2, academicYearId: YEAR, sequence: 2, name: "Semester II", state: "CLOSED", startDate: `${Y0 + 1}-02-01`, endDate: `${Y0 + 1}-06-20` },
    ]);
    for (const code of [A, B, C]) {
      const cid = id();
      courseIds[code] = cid;
      await db.insert(course).values({ id: cid, departmentId: DEPT, code, title: `Course ${code}`, creditHours: 3, isActive: true });
    }
    const rec = (semesterId: string, code: string, letter: string, gp: string) => ({
      studentId: STU, semesterId, courseId: courseIds[code], courseCodeSnapshot: code, courseTitleSnapshot: `Course ${code}`,
      creditHours: "3.0", letter, gradePoint: gp, attemptNo: 1, origin: "IMPORTED" as const,
      countsInGpa: true, countsInAttempted: true, countsInEarned: letter !== "F", wasMajorAtRecord: true, enteredBy: ADMIN,
    });
    await db.insert(academicRecord).values([rec(SEM, A, "B", "3.00"), rec(SEM, B, "C", "2.00"), rec(SEM2, C, "A", "4.00")]);
    await db.transaction((tx) => recomputeStudentSummaries(tx, STU));
  });

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, STU)));
    await quiet(db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, STU)));
    await quiet(db.delete(academicRecord).where(eq(academicRecord.studentId, STU)));
    await quiet(db.delete(course).where(inArray(course.code, [A, B, C, NEWC])));
    await quiet(db.delete(semester).where(inArray(semester.id, [SEM, SEM2])));
    await quiet(db.delete(academicYear).where(eq(academicYear.id, YEAR)));
  });

  it("reports no change when the grid is as it was", async () => {
    const recs = await live();
    const c = await checkSemesterEdit(
      admin,
      base(recs.map((r) => ({ recordId: r.id, code: r.courseCodeSnapshot, creditHours: Number(r.creditHours), letter: r.letter }))),
    );
    expect(c.unchanged).toBe(true);
    expect(c.problems).toEqual([]);
  });

  it("requires a reason once something changes", async () => {
    const [first] = await live();
    const c = await checkSemesterEdit(admin, base([{ recordId: first.id, code: first.courseCodeSnapshot, creditHours: 3, letter: "A" }], { reason: " " }));
    expect(c.problems.join(" ")).toMatch(/reason/i);
  });

  it("checks a change without writing anything, and reports the GPA before and after", async () => {
    const [a, b] = await live();
    const input = base([
      { recordId: a.id, code: a.courseCodeSnapshot, creditHours: 3, letter: "A" },
      { code: NEWC, creditHours: 2, letter: "B", newCourse: { mode: "catalogue", title: "Brand New", departmentId: DEPT } },
    ]);
    const c = await checkSemesterEdit(admin, input);
    expect(c.problems).toEqual([]);
    expect(c.changes.map((x) => x.kind).sort()).toEqual(["added", "changed", "removed"]);
    expect(c.newCourses[0]).toMatch(/Brand New \(2 hrs, Edit Dept\)/);
    // before: (9 + 6) / 6 = 2.5   after: (12 + 6) / 5 = 3.6
    expect(c.summary.before.semesterGpa).toBeCloseTo(2.5, 2);
    expect(c.summary.after.semesterGpa).toBeCloseTo(3.6, 2);

    // Nothing was written.
    expect(await db.query.course.findFirst({ where: eq(course.code, NEWC) })).toBeUndefined();
    const stillThere = await live();
    expect(stillThere.map((r) => [r.courseCodeSnapshot, r.letter])).toEqual([[A, "B"], [B, "C"]]);
    expect(b.isVoid).toBe(false);
  });

  it("saves edits, a removal and an addition together, with the catalogue course, audit and summaries", async () => {
    const [a] = await live();
    const r = await saveSemesterEdit(
      admin,
      base([
        { recordId: a.id, code: a.courseCodeSnapshot, creditHours: 3, letter: "A" },
        { code: NEWC, creditHours: 2, letter: "B", newCourse: { mode: "catalogue", title: "Brand New", departmentId: DEPT } },
      ]),
    );
    expect(r).toMatchObject({ added: 1, changed: 1, removed: 1, createdCourseCodes: [NEWC] });

    const recs = await live();
    expect(recs.map((x) => [x.courseCodeSnapshot, x.letter, x.creditHours, x.courseId !== null])).toEqual([
      [A, "A", "3.0", true],
      [NEWC, "B", "2.0", true],
    ]);
    const voided = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, STU), eq(academicRecord.isVoid, true)),
    });
    expect(voided.map((v) => [v.courseCodeSnapshot, v.voidReason])).toEqual([[B, "Corrected from the original paper sheet"]]);
    expect(await db.query.course.findFirst({ where: eq(course.code, NEWC) })).toMatchObject({ title: "Brand New", creditHours: 2 });

    const sem = await db.query.studentSemesterSummary.findFirst({
      where: and(eq(studentSemesterSummary.studentId, STU), eq(studentSemesterSummary.semesterId, SEM)),
    });
    expect(Number(sem?.gpa)).toBeCloseTo(3.6, 2);
    // CGPA now: (12 + 6 + 12) / 8 = 3.75
    const cum = await db.query.studentCumulativeSummary.findFirst({ where: eq(studentCumulativeSummary.studentId, STU) });
    expect(Number(cum?.cgpa)).toBeCloseTo(3.75, 2);
  });

  it("treats a changed course code as removing one grade and adding another, and refuses a duplicate or unknown code", async () => {
    const recs = await live();
    const a = recs.find((r) => r.courseCodeSnapshot === A)!;
    const keep = recs.find((r) => r.courseCodeSnapshot === NEWC)!;
    const dup = await checkSemesterEdit(
      admin,
      base([
        { recordId: a.id, code: NEWC, creditHours: 3, letter: "A" },
        { recordId: keep.id, code: NEWC, creditHours: 2, letter: "B" },
      ]),
    );
    expect(dup.problems.join(" ")).toMatch(/appears twice/);

    const unknown = await checkSemesterEdit(admin, base([{ recordId: a.id, code: "ZZ999", creditHours: 3, letter: "A" }, { recordId: keep.id, code: NEWC, creditHours: 2, letter: "B" }]));
    expect(unknown.problems.join(" ")).toMatch(/not in the catalogue/);

    await saveSemesterEdit(admin, base([{ recordId: a.id, code: B, creditHours: 3, letter: "A" }, { recordId: keep.id, code: NEWC, creditHours: 2, letter: "B" }]));
    const after = await live();
    expect(after.map((x) => x.courseCodeSnapshot).sort()).toEqual([B, NEWC].sort());
    // The grade for A was voided, not edited in place.
    const oldA = await db.query.academicRecord.findFirst({ where: eq(academicRecord.id, a.id) });
    expect(oldA?.isVoid).toBe(true);
  });

  it("removes a whole semester only when confirmed, and keeps the other semester", async () => {
    const empty = await checkSemesterEdit(admin, base([]));
    expect(empty.toConfirm.join(" ")).toMatch(/Every grade will be removed/);
    await expect(saveSemesterEdit(admin, base([]))).rejects.toThrow(/tick the box/);
    await saveSemesterEdit(admin, base([], { confirmed: true }));
    expect(await live()).toEqual([]);
    const other = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, STU), eq(academicRecord.semesterId, SEM2), eq(academicRecord.isVoid, false)),
    });
    expect(other).toHaveLength(1);
  });
});
