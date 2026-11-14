import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
} from "@/lib/db/schema";
import { updateStudentProfile } from "../students";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Correcting a student's department. By default the "major" flag on past
 * grades is left as it was (a genuine change of major must not rewrite
 * history); when the department was a data-entry mistake the admin can ask
 * for the flag on IMPORTED records to be re-derived from the new department.
 */
const id = () => randomUUID();
const ADMIN = id(), STU = id(), COLLEGE_A = id(), COLLEGE_B = id();
const DEPT_A = id(), DEPT_B = id(), YEAR = id(), SEM = id(), COURSE_A = id(), COURSE_B = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const STUDENT_NO = `2016${String(Date.now() % 1000).padStart(3, "0")}`;
const Y0 = 1900 + ((Date.now() + 91) % 88);
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;

const flags = async () =>
  Object.fromEntries(
    (await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, STU) })).map((r) => [
      r.courseCodeSnapshot,
      r.wasMajorAtRecord,
    ]),
  );

describe("student department correction and the major flag", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `mf-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Flo", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values([
      { id: COLLEGE_A, code: `MA-${tag}`, name: "College A", isActive: true },
      { id: COLLEGE_B, code: `MB-${tag}`, name: "College B", isActive: true },
    ]);
    await db.insert(departmentTable).values([
      { id: DEPT_A, collegeId: COLLEGE_A, code: `MFA${tag}`, name: "Dept A", isActive: true },
      { id: DEPT_B, collegeId: COLLEGE_B, code: `MFB${tag}`, name: "Dept B", isActive: true },
    ]);
    await db.insert(student).values({
      id: STU, studentNumber: STUDENT_NO, firstName: "Flo", lastName: `Flag${tag}`,
      departmentId: DEPT_A, enrolmentYear: Y0, historicalImportStatus: "COMPLETE", createdBy: ADMIN,
    });
    await db.insert(academicYear).values({ id: YEAR, label: `${Y0}/${Y0 + 1}`, startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-06-30`, isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "CLOSED", startDate: `${Y0}-09-01`, endDate: `${Y0}-12-20` });
    await db.insert(course).values([
      { id: COURSE_A, departmentId: DEPT_A, code: `FA${tag}101`, title: "A course", creditHours: 3, isActive: true },
      { id: COURSE_B, departmentId: DEPT_B, code: `FB${tag}101`, title: "B course", creditHours: 3, isActive: true },
    ]);
    const rec = (courseId: string | null, code: string, major: boolean) => ({
      studentId: STU, semesterId: SEM, courseId, courseCodeSnapshot: code, courseTitleSnapshot: code,
      creditHours: "3.0", letter: "D", gradePoint: "1.00", attemptNo: 1, origin: "IMPORTED" as const,
      countsInGpa: true, countsInAttempted: true, countsInEarned: true, wasMajorAtRecord: major, enteredBy: ADMIN,
    });
    await db.insert(academicRecord).values([
      rec(COURSE_A, `FA${tag}101`, true),
      rec(COURSE_B, `FB${tag}101`, false),
      rec(null, `OLD${tag}101`, true),
    ]);
  });

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(academicRecord).where(eq(academicRecord.studentId, STU)));
    await quiet(db.delete(course).where(inArray(course.id, [COURSE_A, COURSE_B])));
    await quiet(db.delete(semester).where(eq(semester.id, SEM)));
    await quiet(db.delete(academicYear).where(eq(academicYear.id, YEAR)));
  });

  it("leaves the major flag alone by default (a real change of major)", async () => {
    await updateStudentProfile(admin, STU, { departmentId: DEPT_B });
    expect(await flags()).toEqual({ [`FA${tag}101`]: true, [`FB${tag}101`]: false, [`OLD${tag}101`]: true });
  });

  it("re-derives the flag from the new department when asked, and reports how many changed", async () => {
    let changed = -1;
    await updateStudentProfile(
      admin,
      STU,
      { departmentId: DEPT_A, recalculateMajorFlags: true },
      { onMajorFlagsRecalculated: (n) => (changed = n) },
    );
    // Only the grade with no catalogue course differs: it cannot be a major course.
    expect(changed).toBe(1);
    expect(await flags()).toEqual({ [`FA${tag}101`]: true, [`FB${tag}101`]: false, [`OLD${tag}101`]: false });

    await updateStudentProfile(
      admin,
      STU,
      { departmentId: DEPT_B, recalculateMajorFlags: true },
      { onMajorFlagsRecalculated: (n) => (changed = n) },
    );
    expect(changed).toBe(2);
    expect(await flags()).toEqual({ [`FA${tag}101`]: false, [`FB${tag}101`]: true, [`OLD${tag}101`]: false });
  });

  it("ignores the recalculate request when the department did not change", async () => {
    let called = false;
    await updateStudentProfile(
      admin,
      STU,
      { departmentId: DEPT_B, minor: "Dept A", recalculateMajorFlags: true },
      { onMajorFlagsRecalculated: () => (called = true) },
    );
    expect(called).toBe(false);
  });
});
