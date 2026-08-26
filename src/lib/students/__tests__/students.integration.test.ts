import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, department, student, auditLog } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import {
  enrollStudent,
  getStudent,
  resetStudentPassword,
  searchStudents,
  updateStudentProfile,
} from "../students";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.6 Stage 5 acceptance criteria, automated: duplicate Student ID
 * refused, enrolment atomicity, status transitions audited, Super Admin
 * read-only, and -- the single most important negative test in the system
 * (Section 18.4/24.6) -- a student cannot reach another student's record
 * by any route.
 */

let adminActor: Actor;
let adminUserId: string;
let departmentId: string;
const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };
const superAdminActor: Actor = { userId: "00000000-0000-0000-0000-000000000002", role: "SUPER_ADMIN" };

const cleanupStudentUserIds: string[] = [];

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's Admin fixture.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

function makeStudentNumber(): { studentNumber: string; enrolmentYear: number } {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return { studentNumber: `2026${suffix}`, enrolmentYear: 2026 };
}

async function enrollTestStudent(overrides: Partial<Parameters<typeof enrollStudent>[1]> = {}) {
  const { studentNumber, enrolmentYear } = makeStudentNumber();
  const result = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Test",
    lastName: `Student-${studentNumber}`,
    departmentId,
    enrolmentYear,
    ...overrides,
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.studentNumber) });
  if (!row) throw new Error("enrollment fixture setup failed");
  cleanupStudentUserIds.push(row.id);
  return { ...result, id: row.id, actor: { userId: row.id, role: "STUDENT" as const } };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-students-admin-${Date.now()}`,
    displayName: "Students Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to bootstrap this suite's fixtures.");
  departmentId = dept.id;
});

afterAll(async () => {
  // This suite enrolls one real Supabase Auth user + two DB rows per test
  // fixture (14 tests, most enrolling at least one student) -- each
  // cleanup iteration is a real network round trip, comfortably over the
  // 10s default hook timeout.
  for (const id of cleanupStudentUserIds) {
    await db.delete(student).where(eq(student.id, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id)).catch(() => {});
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
}, 120_000);

describe("enrollStudent", () => {
  it("creates app_user and student atomically, and audits STUDENT_CREATED", async () => {
    const enrolled = await enrollTestStudent();
    expect(enrolled.temporaryPassword).toBeTruthy();

    const userRow = await db.query.appUser.findFirst({ where: eq(appUser.id, enrolled.id) });
    const studentRow = await db.query.student.findFirst({ where: eq(student.id, enrolled.id) });
    expect(userRow?.role).toBe("STUDENT");
    expect(userRow?.mustChangePassword).toBe(true);
    expect(studentRow?.status).toBe("ACTIVE");
    expect(studentRow?.historicalImportStatus).toBe("NOT_STARTED");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "student"), eq(auditLog.entityId, enrolled.id)),
    });
    expect(entries.find((e) => e.action === "STUDENT_CREATED")).toBeTruthy();
  });

  it("refuses a duplicate Student ID", async () => {
    const enrolled = await enrollTestStudent();

    await expect(
      enrollStudent(adminActor, {
        studentNumber: enrolled.studentNumber,
        firstName: "Duplicate",
        lastName: "Attempt",
        departmentId,
        enrolmentYear: 2026,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a malformed Student ID", async () => {
    await expect(
      enrollStudent(adminActor, {
        studentNumber: "not-a-valid-id",
        firstName: "Bad",
        lastName: "Id",
        departmentId,
        enrolmentYear: 2026,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an enrolment year that doesn't match the Student ID's admission year", async () => {
    const { studentNumber } = makeStudentNumber();
    await expect(
      enrollStudent(adminActor, {
        studentNumber,
        firstName: "Mismatch",
        lastName: "Year",
        departmentId,
        enrolmentYear: 2020,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an inactive department", async () => {
    const inactiveDept = await db.query.department.findFirst({ where: eq(department.isActive, false) });
    if (!inactiveDept) return; // no inactive department exists in this environment; nothing to assert

    const { studentNumber, enrolmentYear } = makeStudentNumber();
    await expect(
      enrollStudent(adminActor, {
        studentNumber,
        firstName: "Inactive",
        lastName: "Dept",
        departmentId: inactiveDept.id,
        enrolmentYear,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a Student and a Super Admin", async () => {
    const { studentNumber, enrolmentYear } = makeStudentNumber();
    await expect(
      enrollStudent(studentActor, { studentNumber, firstName: "A", lastName: "B", departmentId, enrolmentYear }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      enrollStudent(superAdminActor, { studentNumber, firstName: "A", lastName: "B", departmentId, enrolmentYear }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("updateStudentProfile", () => {
  it("updates only changed fields, audits old/new values, and syncs display_name on a name change", async () => {
    const enrolled = await enrollTestStudent();

    const updated = await updateStudentProfile(adminActor, enrolled.id, { firstName: "Updated" });
    expect(updated.firstName).toBe("Updated");

    const userRow = await db.query.appUser.findFirst({ where: eq(appUser.id, enrolled.id) });
    expect(userRow?.displayName).toContain("Updated");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "student"), eq(auditLog.entityId, enrolled.id)),
    });
    const updateEntry = entries.find((e) => e.action === "STUDENT_UPDATED");
    expect(updateEntry?.oldValue).toEqual({ firstName: "Test" });
    expect(updateEntry?.newValue).toEqual({ firstName: "Updated" });
  });

  it("changes status (e.g. Active -> Inactive) and audits it", async () => {
    const enrolled = await enrollTestStudent();

    const updated = await updateStudentProfile(adminActor, enrolled.id, { status: "INACTIVE" });
    expect(updated.status).toBe("INACTIVE");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "student"), eq(auditLog.entityId, enrolled.id)),
    });
    const statusEntry = entries.find(
      (e) => e.action === "STUDENT_UPDATED" && (e.newValue as { status?: string })?.status === "INACTIVE",
    );
    expect(statusEntry?.oldValue).toMatchObject({ status: "ACTIVE" });
  });

  it("refuses a Student and a Super Admin", async () => {
    const enrolled = await enrollTestStudent();
    await expect(
      updateStudentProfile(studentActor, enrolled.id, { status: "INACTIVE" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateStudentProfile(superAdminActor, enrolled.id, { status: "INACTIVE" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("resetStudentPassword", () => {
  it("issues a new temporary password and forces a change on next login", async () => {
    const enrolled = await enrollTestStudent();
    await db.update(appUser).set({ mustChangePassword: false }).where(eq(appUser.id, enrolled.id));

    const result = await resetStudentPassword(adminActor, enrolled.id);
    expect(result.temporaryPassword).toBeTruthy();

    const userRow = await db.query.appUser.findFirst({ where: eq(appUser.id, enrolled.id) });
    expect(userRow?.mustChangePassword).toBe(true);

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "app_user"), eq(auditLog.entityId, enrolled.id)),
    });
    expect(entries.find((e) => e.action === "PASSWORD_RESET_BY_ADMIN")).toBeTruthy();
  });

  it("refuses a Student and a Super Admin", async () => {
    const enrolled = await enrollTestStudent();
    await expect(resetStudentPassword(studentActor, enrolled.id)).rejects.toThrow(ForbiddenError);
    await expect(resetStudentPassword(superAdminActor, enrolled.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("student isolation (Section 18.4) -- the single most important negative test in the system", () => {
  it("a student cannot read another student's record via getStudent", async () => {
    const studentA = await enrollTestStudent();
    const studentB = await enrollTestStudent();

    const own = await getStudent(studentA.actor, studentA.id);
    expect(own.id).toBe(studentA.id);

    await expect(getStudent(studentA.actor, studentB.id)).rejects.toThrow(NotFoundError);
  });

  it("a student's search only ever returns their own row, never another student's", async () => {
    const studentA = await enrollTestStudent();
    await enrollTestStudent();

    const results = await searchStudents(studentA.actor, {});
    expect(results.rows.map((r) => r.id)).toEqual([studentA.id]);
  });

  it("Admin and Super Admin can both read any student's record", async () => {
    const enrolled = await enrollTestStudent();
    // Reads go through asUser()/RLS, which needs a REAL app_user row for
    // current_user_role() to resolve -- unlike the ForbiddenError tests
    // above, where assertCan() rejects before any row is touched, so the
    // fabricated module-level superAdminActor works fine there but not here.
    const realSuperAdmin = await realSuperAdminActor();

    const asAdmin = await getStudent(adminActor, enrolled.id);
    const asSuperAdmin = await getStudent(realSuperAdmin, enrolled.id);
    expect(asAdmin.id).toBe(enrolled.id);
    expect(asSuperAdmin.id).toBe(enrolled.id);
  });
});
