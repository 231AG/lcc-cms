import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, TransactionRollbackError } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  appUser,
  department,
  student,
  academicRecord,
  academicYear,
  course,
  semester,
  studentCumulativeSummary,
  studentSemesterSummary,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { enrollStudent } from "@/lib/students/students";
import { createAcademicYear, createSemester } from "@/lib/academic/calendar";
import { createCourse } from "@/lib/academic/structure";
import { correctHistoricalRecord, createRetrospectiveSemester, enterHistoricalSemester, markImportComplete, reopenImportStatus, voidHistoricalRecord } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "../gpa";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Fixtures F-30/F-31/F-32/F-37/F-40's real subject: the recomputation
 * SERVICE (transactional recompute-on-write, provisional propagation),
 * as opposed to engine.test.ts's pure arithmetic. Driven through the
 * actual Stage 6 entry/correction/void/status functions, exactly as a
 * real Admin would trigger them, against the live database.
 */

let adminActor: Actor;
let adminUserId: string;
let departmentId: string;
let courseCode: string;
let courseId: string;
let pastSemesterId: string;

const cleanupStudentUserIds: string[] = [];
const cleanupExtraSemesterIds: string[] = [];

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

function makeStudentNumber(): { studentNumber: string; enrolmentYear: number } {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return { studentNumber: `2017${suffix}`, enrolmentYear: 2017 };
}

async function enrollTestStudent() {
  const { studentNumber, enrolmentYear } = makeStudentNumber();
  const result = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Gpa",
    lastName: `Fixture-${studentNumber}`,
    departmentId,
    enrolmentYear,
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.studentNumber) });
  if (!row) throw new Error("enrollment fixture setup failed");
  cleanupStudentUserIds.push(row.id);
  return { id: row.id, actor: { userId: row.id, role: "STUDENT" as const } };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-gpa-admin-${Date.now()}`,
    displayName: "GPA Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to bootstrap this suite's fixtures.");
  departmentId = dept.id;

  courseCode = `GPA${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, {
    departmentId,
    code: courseCode,
    title: "GPA Test Course",
    creditHours: 3,
  });
  courseId = courseRow.id;

  const year = await createAcademicYear(adminActor, {
    label: "2017/2018",
    startDate: "2017-08-01",
    endDate: "2018-06-30",
  }).catch(async () => {
    const existing = await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2017/2018") });
    if (!existing) throw new Error("could not create or find fixture academic year");
    return existing;
  });

  const sem = await createRetrospectiveSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2017-09-01",
    endDate: "2018-01-15",
  });
  pastSemesterId = sem.id;
}, 60_000);

afterAll(async () => {
  for (const id of cleanupStudentUserIds) {
    await db.delete(academicRecord).where(eq(academicRecord.studentId, id)).catch(() => {});
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, id)).catch(() => {});
    await db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, id)).catch(() => {});
    await db.delete(student).where(eq(student.id, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id)).catch(() => {});
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  await db.delete(course).where(eq(course.id, courseId)).catch(() => {});
  for (const id of cleanupExtraSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  await db.delete(semester).where(eq(semester.id, pastSemesterId)).catch(() => {});
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
}, 60_000);

describe("recomputation on historical entry", () => {
  it("F-30/F-32: writes a provisional summary in the same transaction as entry", async () => {
    const enrolled = await enrollTestStudent();

    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "B+" }],
    });

    const semesterSummaries = await getSemesterSummaries(adminActor, enrolled.id);
    expect(semesterSummaries).toHaveLength(1);
    expect(semesterSummaries[0].gpa).toBe("3.300");
    expect(semesterSummaries[0].isProvisional).toBe(true);

    const cumulative = await getCumulativeSummary(adminActor, enrolled.id);
    expect(cumulative?.cgpa).toBe("3.300");
    expect(cumulative?.isProvisional).toBe(true);
    expect(cumulative?.standing).toBeNull(); // F-44b: suppressed while provisional
  });

  it("F-31: marking import Complete flips is_provisional on both summaries in one transaction", async () => {
    const enrolled = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "A-" }],
    });

    await markImportComplete(adminActor, enrolled.id);

    const semesterSummaries = await getSemesterSummaries(adminActor, enrolled.id);
    const cumulative = await getCumulativeSummary(adminActor, enrolled.id);
    expect(semesterSummaries[0].isProvisional).toBe(false);
    expect(cumulative?.isProvisional).toBe(false);
    expect(cumulative?.standing).toBe("HONOURS"); // 3.700 CGPA

    // Reopening flips it back (F-31's inverse).
    await reopenImportStatus(adminActor, enrolled.id, "Found another paper record.");
    const reopened = await getCumulativeSummary(adminActor, enrolled.id);
    expect(reopened?.isProvisional).toBe(true);
    expect(reopened?.standing).toBeNull();
  });

  it("F-37-equivalent: a correction recomputes the CGPA by exactly the expected amount", async () => {
    const enrolled = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "F" }],
    });

    const before = await getCumulativeSummary(adminActor, enrolled.id);
    expect(before?.cgpa).toBe("0.000");

    const [entered] = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, enrolled.id), eq(academicRecord.isVoid, false)),
    });
    await correctHistoricalRecord(adminActor, entered.id, { letter: "B-", reason: "Paper record misread." });

    const after = await getCumulativeSummary(adminActor, enrolled.id);
    expect(after?.cgpa).toBe("2.700");

    const obligationsAfter = await getOutstandingRepeatObligations(adminActor, enrolled.id);
    expect(obligationsAfter).toHaveLength(0); // the F obligation is cleared by the correction
  });

  it("voiding a record removes it from the recomputed CGPA", async () => {
    const enrolled = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "A+" }],
    });
    const [entered] = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, enrolled.id), eq(academicRecord.isVoid, false)),
    });

    await voidHistoricalRecord(adminActor, entered.id, "Entered against the wrong student.");

    const cumulative = await getCumulativeSummary(adminActor, enrolled.id);
    expect(cumulative?.cgpa).toBeNull();
    expect(cumulative?.totalCreditsAttempted).toBe("0.0");
  });

  it("a repeat recomputes is_repeat_dropped and drops the earlier attempt from CGPA end to end", async () => {
    const enrolled = await enrollTestStudent();
    const secondSemester = await createSemester(adminActor, {
      academicYearId: (await db.query.semester.findFirst({ where: eq(semester.id, pastSemesterId) }))!.academicYearId,
      sequence: 2,
      name: "Second Semester",
      startDate: "2018-02-01",
      endDate: "2018-06-30",
    });
    cleanupExtraSemesterIds.push(secondSemester.id);

    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "A+" }],
    });
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: secondSemester.id,
      records: [{ courseCode, creditHours: 3, letter: "C-", confirmAsRepeat: true }],
    });

    const cumulative = await getCumulativeSummary(adminActor, enrolled.id);
    expect(cumulative?.cgpa).toBe("1.700"); // most recent (C-) counts, matching F-13's shape

    const records = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, enrolled.id), eq(academicRecord.isVoid, false)),
    });
    const firstAttempt = records.find((r) => r.attemptNo === 1);
    const secondAttempt = records.find((r) => r.attemptNo === 2);
    expect(firstAttempt?.isRepeatDropped).toBe(true);
    expect(secondAttempt?.isRepeatDropped).toBe(false);
  });

  it("a student can only read their own semester and cumulative summaries", async () => {
    const studentA = await enrollTestStudent();
    const studentB = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: studentA.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "B+" }],
    });

    const ownSummaries = await getSemesterSummaries(studentA.actor, studentA.id);
    expect(ownSummaries).toHaveLength(1);

    const crossStudentSummaries = await getSemesterSummaries(studentB.actor, studentA.id);
    expect(crossStudentSummaries).toHaveLength(0); // RLS returns nothing, not another student's data
  });
});

describe("F-40: reconciliation queries (Section 22.4)", () => {
  it("finds zero mismatches and zero repeat-coherence issues after ordinary entry, correction and repeat", async () => {
    const { reconcileRepeatResolutionCoherence, reconcileSummariesMatchEngine } = await import("../reconciliation");

    const enrolled = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode, creditHours: 3, letter: "C-" }],
    });
    const [entered] = await db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, enrolled.id), eq(academicRecord.isVoid, false)),
    });
    await correctHistoricalRecord(adminActor, entered.id, { letter: "B+", reason: "Recheck against paper." });

    await db.transaction(async (tx) => {
      const mismatches = await reconcileSummariesMatchEngine(tx, [enrolled.id]);
      expect(mismatches).toEqual([]);
      const issues = await reconcileRepeatResolutionCoherence(tx, [enrolled.id]);
      expect(issues).toEqual([]);
      tx.rollback();
    }).catch((err) => {
      if (!(err instanceof TransactionRollbackError)) throw err;
    });
  });
});
