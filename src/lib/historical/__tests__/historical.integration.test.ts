import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, academicRecord, academicYear, semester, student, auditLog, department, course, studentSemesterSummary, studentCumulativeSummary } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { enrollStudent } from "@/lib/students/students";
import { createAcademicYear } from "@/lib/academic/calendar";
import { createCourse } from "@/lib/academic/structure";
import {
  createRetrospectiveSemester,
  correctHistoricalRecord,
  enterHistoricalSemester,
  markImportComplete,
  reopenImportStatus,
  voidHistoricalRecord,
} from "../historical";
import { ForbiddenError, StateError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.7 Stage 6 acceptance criteria, automated: a full past
 * semester enters in one save; a duplicate is refused and the existing
 * record identifiable; an unknown course code is accepted with a warning;
 * import status moves through its three values with audit; corrections
 * and voids are audited with a mandatory reason.
 */

let adminActor: Actor;
let adminUserId: string;
let departmentId: string;
let knownCourseId: string;
let knownCourseCode: string;
let pastSemesterId: string;
const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };
const superAdminActor: Actor = { userId: "00000000-0000-0000-0000-000000000002", role: "SUPER_ADMIN" };

const cleanupStudentUserIds: string[] = [];
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];
const cleanupCourseIds: string[] = [];

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

function makeStudentNumber(): { studentNumber: string; enrolmentYear: number } {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return { studentNumber: `2018${suffix}`, enrolmentYear: 2018 };
}

async function enrollTestStudent() {
  const { studentNumber, enrolmentYear } = makeStudentNumber();
  const result = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Historical",
    lastName: `Fixture-${studentNumber}`,
    departmentId,
    enrolmentYear,
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.studentNumber) });
  if (!row) throw new Error("enrollment fixture setup failed");
  cleanupStudentUserIds.push(row.id);
  return { id: row.id, studentNumber: result.studentNumber };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-historical-admin-${Date.now()}`,
    displayName: "Historical Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to bootstrap this suite's fixtures.");
  departmentId = dept.id;

  knownCourseCode = `HIST${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, {
    departmentId,
    code: knownCourseCode,
    title: "Historical Test Course",
    creditHours: 3,
  });
  knownCourseId = courseRow.id;
  cleanupCourseIds.push(knownCourseId);

  const year = await createAcademicYear(adminActor, {
    label: "2018/2019",
    startDate: "2018-08-01",
    endDate: "2019-06-30",
  }).catch(async () => {
    const existing = await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2018/2019") });
    if (!existing) throw new Error("could not create or find fixture academic year");
    return existing;
  });
  cleanupAcademicYearIds.push(year.id);

  const sem = await createRetrospectiveSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2018-09-01",
    endDate: "2019-01-15",
  });
  pastSemesterId = sem.id;
  cleanupSemesterIds.push(sem.id);
}, 60_000);

afterAll(async () => {
  for (const id of cleanupStudentUserIds) {
    await db.delete(academicRecord).where(eq(academicRecord.studentId, id)).catch(() => {});
    // Stage 7 wired recomputation into every entry/correction/void/status
    // action in this file, so every test student now has summary rows too
    // -- both reference `semester` with a RESTRICT FK, so they must go
    // before the semester cleanup below, not just before `student`.
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, id)).catch(() => {});
    await db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, id)).catch(() => {});
    await db.delete(student).where(eq(student.id, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id)).catch(() => {});
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  for (const id of cleanupSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  for (const id of cleanupAcademicYearIds) {
    await db.delete(academicYear).where(eq(academicYear.id, id)).catch(() => {});
  }
  for (const id of cleanupCourseIds) {
    await db.delete(course).where(eq(course.id, id)).catch(() => {});
  }
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
}, 120_000);

describe("createRetrospectiveSemester", () => {
  it("creates a semester directly in CLOSED state", async () => {
    expect(pastSemesterId).toBeTruthy();
    const row = await db.query.semester.findFirst({ where: eq(semester.id, pastSemesterId) });
    expect(row?.state).toBe("CLOSED");
  });

  it("refuses a semester whose end date is not in the past", async () => {
    const year = await db.query.academicYear.findFirst({ where: eq(academicYear.id, cleanupAcademicYearIds[0]) });
    await expect(
      createRetrospectiveSemester(adminActor, {
        academicYearId: year!.id,
        sequence: 2,
        name: "Second Semester",
        startDate: "2018-09-01",
        endDate: "2099-01-15",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a Student and a Super Admin", async () => {
    await expect(
      createRetrospectiveSemester(studentActor, {
        academicYearId: cleanupAcademicYearIds[0],
        sequence: 2,
        name: "x",
        startDate: "2018-09-01",
        endDate: "2018-10-01",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createRetrospectiveSemester(superAdminActor, {
        academicYearId: cleanupAcademicYearIds[0],
        sequence: 2,
        name: "x",
        startDate: "2018-09-01",
        endDate: "2018-10-01",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("enterHistoricalSemester", () => {
  it("enters a full semester in one save, sets IN_PROGRESS, and audits", async () => {
    const enrolled = await enrollTestStudent();

    const result = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [
        { courseCode: knownCourseCode, creditHours: 3, letter: "B+" },
        { courseCode: "UNKNOWN999", creditHours: 3, letter: "A-" },
      ],
    });

    expect(result.created).toHaveLength(2);
    expect(result.warnings.some((w) => w.courseCode === "UNKNOWN999")).toBe(true);

    const studentRow = await db.query.student.findFirst({ where: eq(student.id, enrolled.id) });
    expect(studentRow?.historicalImportStatus).toBe("IN_PROGRESS");

    const known = result.created.find((r) => r.courseCodeSnapshot === knownCourseCode);
    expect(known?.courseId).toBe(knownCourseId);
    const unknown = result.created.find((r) => r.courseCodeSnapshot === "UNKNOWN999");
    expect(unknown?.courseId).toBeNull();

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "academic_record"), eq(auditLog.studentId, enrolled.id)),
    });
    expect(entries.filter((e) => e.action === "HISTORICAL_RECORD_ENTERED")).toHaveLength(2);
  });

  it("refuses a duplicate course in the same semester without confirmAsRepeat, and allows it with confirmAsRepeat", async () => {
    const enrolled = await enrollTestStudent();

    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "F" }],
    });

    await expect(
      enterHistoricalSemester(adminActor, {
        studentId: enrolled.id,
        semesterId: pastSemesterId,
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
      }),
    ).rejects.toThrow(ValidationError);

    const repeatResult = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+", confirmAsRepeat: true }],
    });
    expect(repeatResult.created[0].attemptNo).toBe(2);
  });

  it("refuses two rows for the same course within one batch, unless the second confirms as a repeat", async () => {
    const enrolled = await enrollTestStudent();

    await expect(
      enterHistoricalSemester(adminActor, {
        studentId: enrolled.id,
        semesterId: pastSemesterId,
        records: [
          { courseCode: knownCourseCode, creditHours: 3, letter: "B+" },
          { courseCode: knownCourseCode, creditHours: 3, letter: "A-" },
        ],
      }),
    ).rejects.toThrow(ValidationError);

    const result = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [
        { courseCode: knownCourseCode, creditHours: 3, letter: "B+" },
        { courseCode: knownCourseCode, creditHours: 3, letter: "A-", confirmAsRepeat: true },
      ],
    });
    expect(result.created.map((r) => r.attemptNo).sort()).toEqual([1, 2]);
  });

  it("refuses a grade letter not in the active grade scale", async () => {
    const enrolled = await enrollTestStudent();
    await expect(
      enterHistoricalSemester(adminActor, {
        studentId: enrolled.id,
        semesterId: pastSemesterId,
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "Z" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a semester that has not yet ended", async () => {
    const enrolled = await enrollTestStudent();
    const futureYear = await createAcademicYear(adminActor, {
      label: "2099/2100",
      startDate: "2099-08-01",
      endDate: "2100-06-30",
    }).catch(async () => {
      const existing = await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2099/2100") });
      if (!existing) throw new Error("fixture setup failed");
      return existing;
    });
    const { createSemester } = await import("@/lib/academic/calendar");
    const futureSem = await createSemester(adminActor, {
      academicYearId: futureYear.id,
      sequence: 1,
      name: "First Semester",
      startDate: "2099-09-01",
      endDate: "2100-01-15",
    });

    await expect(
      enterHistoricalSemester(adminActor, {
        studentId: enrolled.id,
        semesterId: futureSem.id,
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
      }),
    ).rejects.toThrow(ValidationError);

    await db.delete(semester).where(eq(semester.id, futureSem.id));
    await db.delete(academicYear).where(eq(academicYear.id, futureYear.id));
  });

  it("refuses a semester that precedes the student's enrolment year", async () => {
    const { studentNumber, enrolmentYear } = makeStudentNumber();
    const laterYear = enrolmentYear + 5;
    const result = await enrollStudent(adminActor, {
      studentNumber: String(laterYear) + studentNumber.slice(4),
      firstName: "Later",
      lastName: "Enrolee",
      departmentId,
      enrolmentYear: laterYear,
    });
    const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.studentNumber) });
    cleanupStudentUserIds.push(row!.id);

    await expect(
      enterHistoricalSemester(adminActor, {
        studentId: row!.id,
        semesterId: pastSemesterId, // 2018 semester, student enrolled 5 years later
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a Student and a Super Admin", async () => {
    const enrolled = await enrollTestStudent();
    await expect(
      enterHistoricalSemester(studentActor, {
        studentId: enrolled.id,
        semesterId: pastSemesterId,
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      enterHistoricalSemester(superAdminActor, {
        studentId: enrolled.id,
        semesterId: pastSemesterId,
        records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("correctHistoricalRecord and voidHistoricalRecord", () => {
  it("corrects a record's grade and audits old/new with the reason", async () => {
    const enrolled = await enrollTestStudent();
    const { created } = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "C+" }],
    });

    const corrected = await correctHistoricalRecord(adminActor, created[0].id, {
      letter: "B+",
      reason: "Paper record was misread on first entry.",
    });
    expect(corrected.letter).toBe("B+");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "academic_record"), eq(auditLog.entityId, created[0].id)),
    });
    const correctionEntry = entries.find((e) => e.action === "HISTORICAL_RECORD_CORRECTED");
    expect(correctionEntry?.reason).toBe("Paper record was misread on first entry.");
  });

  it("requires a reason to correct or void", async () => {
    const enrolled = await enrollTestStudent();
    const { created } = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "C+" }],
    });

    await expect(
      correctHistoricalRecord(adminActor, created[0].id, { letter: "B+", reason: "" }),
    ).rejects.toThrow(ValidationError);
    await expect(voidHistoricalRecord(adminActor, created[0].id, "")).rejects.toThrow(ValidationError);
  });

  it("voids a record instead of deleting it, and excludes it from active queries", async () => {
    const enrolled = await enrollTestStudent();
    const { created } = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "C+" }],
    });

    await voidHistoricalRecord(adminActor, created[0].id, "Entered against the wrong student.");

    const stillExists = await db.query.academicRecord.findFirst({ where: eq(academicRecord.id, created[0].id) });
    expect(stillExists).toBeTruthy();
    expect(stillExists?.isVoid).toBe(true);

    // Voided, so re-entering the same course for the same student/semester
    // must be accepted as a fresh entry, not refused as a duplicate.
    const reentered = await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
    });
    expect(reentered.created).toHaveLength(1);
  });
});

describe("markImportComplete and reopenImportStatus", () => {
  it("moves NOT_STARTED -> (via entry) IN_PROGRESS -> COMPLETE -> IN_PROGRESS, all audited", async () => {
    const enrolled = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: enrolled.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: knownCourseCode, creditHours: 3, letter: "B+" }],
    });

    const completed = await markImportComplete(adminActor, enrolled.id);
    expect(completed.historicalImportStatus).toBe("COMPLETE");
    expect(completed.importCompletedBy).toBe(adminActor.userId);

    await expect(markImportComplete(adminActor, enrolled.id)).rejects.toThrow(StateError);
    await expect(reopenImportStatus(adminActor, enrolled.id, "")).rejects.toThrow(ValidationError);

    const reopened = await reopenImportStatus(adminActor, enrolled.id, "Found another paper record to add.");
    expect(reopened.historicalImportStatus).toBe("IN_PROGRESS");
    expect(reopened.importCompletedBy).toBeNull();

    // Already IN_PROGRESS at this point -- reopening again must refuse
    // regardless of reason, since only a Complete import can be reopened.
    await expect(reopenImportStatus(adminActor, enrolled.id, "any reason")).rejects.toThrow(StateError);

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "student"), eq(auditLog.studentId, enrolled.id)),
    });
    expect(entries.filter((e) => e.action === "IMPORT_STATUS_CHANGED").length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a Student and a Super Admin", async () => {
    const enrolled = await enrollTestStudent();
    await expect(markImportComplete(studentActor, enrolled.id)).rejects.toThrow(ForbiddenError);
    await expect(markImportComplete(superAdminActor, enrolled.id)).rejects.toThrow(ForbiddenError);
  });
});
