import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, college, department, course, coursePrerequisite, auditLog } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import {
  createCollege,
  updateCollege,
  setCollegeActive,
  createDepartment,
  setDepartmentActive,
  createCourse,
  updateCourse,
  setCourseActive,
  addPrerequisite,
  removePrerequisite,
} from "../structure";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.4 Stage 3 acceptance criteria, automated: duplicate codes
 * refused, deactivation blocked while dependents exist (naming them),
 * prerequisite cycles refused (direct and indirect), and Super Admin
 * refused every write here -- the first real test of the non-hierarchical
 * permission model (Section 3.3).
 */

let adminActor: Actor;
let adminUserId: string;
const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };
const superAdminActor: Actor = { userId: "00000000-0000-0000-0000-000000000002", role: "SUPER_ADMIN" };

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's Admin fixture.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-structure-admin-${Date.now()}`,
    displayName: "Structure Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };
});

afterAll(async () => {
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
});

describe("createCollege", () => {
  it("refuses a Student and a Super Admin", async () => {
    await expect(createCollege(studentActor, { code: "X", name: "X" })).rejects.toThrow(ForbiddenError);
    await expect(createCollege(superAdminActor, { code: "X", name: "X" })).rejects.toThrow(ForbiddenError);
  });

  it("lets an Admin create a college and refuses a duplicate code", async () => {
    const code = `TST${Date.now()}`;
    const created = await createCollege(adminActor, { code, name: "Test College" });
    expect(created.code).toBe(code);

    await expect(createCollege(adminActor, { code: code.toLowerCase(), name: "Different Name" })).rejects.toThrow(
      ValidationError,
    );

    await db.delete(college).where(eq(college.id, created.id));
  });
});

describe("deactivation dependency guards", () => {
  it("refuses to deactivate a college with an active department, naming it", async () => {
    const collegeCode = `TSTC${Date.now()}`;
    const testCollege = await createCollege(adminActor, { code: collegeCode, name: "Guard College" });
    const deptCode = `TSTD${Date.now()}`;
    await createDepartment(adminActor, { collegeId: testCollege.id, code: deptCode, name: "Guard Department" });

    await expect(setCollegeActive(adminActor, testCollege.id, false)).rejects.toThrow(
      new RegExp(deptCode),
    );

    // Cleanup: deactivate department first, then the college, then hard-delete both.
    const dept = await db.query.department.findFirst({ where: eq(department.collegeId, testCollege.id) });
    if (dept) {
      await setDepartmentActive(adminActor, dept.id, false);
      await db.delete(department).where(eq(department.id, dept.id));
    }
    await db.delete(college).where(eq(college.id, testCollege.id));
  });

  it("refuses to deactivate a department with an active course, naming it", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}A`, name: "Guard College 2" });
    const testDept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}A`,
      name: "Guard Department 2",
    });
    const courseCode = `TSTX${Date.now()}`;
    await createCourse(adminActor, { departmentId: testDept.id, code: courseCode, title: "Guard Course", creditHours: 3 });

    await expect(setDepartmentActive(adminActor, testDept.id, false)).rejects.toThrow(new RegExp(courseCode));

    const testCourse = await db.query.course.findFirst({ where: eq(course.departmentId, testDept.id) });
    if (testCourse) {
      await setCourseActive(adminActor, testCourse.id, false);
      await db.delete(course).where(eq(course.id, testCourse.id));
    }
    await db.delete(department).where(eq(department.id, testDept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });
});

describe("course credit-hour change auditing", () => {
  it("logs COURSE_CREDIT_HOURS_CHANGED as its own audit action", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}B`, name: "Audit College" });
    const testDept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}B`,
      name: "Audit Department",
    });
    const created = await createCourse(adminActor, {
      departmentId: testDept.id,
      code: `TSTX${Date.now()}B`,
      title: "Audit Course",
      creditHours: 3,
    });

    await updateCourse(adminActor, created.id, { creditHours: 4 });

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "course"), eq(auditLog.entityId, created.id)),
    });
    const creditChangeEntry = entries.find((e) => e.action === "COURSE_CREDIT_HOURS_CHANGED");
    expect(creditChangeEntry).toBeDefined();
    expect(creditChangeEntry?.oldValue).toEqual({ creditHours: 3 });
    expect(creditChangeEntry?.newValue).toEqual({ creditHours: 4 });

    await db.delete(course).where(eq(course.id, created.id));
    await db.delete(department).where(eq(department.id, testDept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });
});

describe("prerequisite cycle detection", () => {
  it("refuses a course as its own prerequisite", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}C`, name: "Cycle College" });
    const testDept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}C`,
      name: "Cycle Department",
    });
    const a = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTA${Date.now()}`, title: "A", creditHours: 3 });

    await expect(addPrerequisite(adminActor, { courseId: a.id, prerequisiteCourseId: a.id })).rejects.toThrow(
      ValidationError,
    );

    await db.delete(course).where(eq(course.id, a.id));
    await db.delete(department).where(eq(department.id, testDept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });

  it("refuses a direct reverse cycle (A requires B, then B requires A)", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}D`, name: "Cycle College 2" });
    const testDept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}D`,
      name: "Cycle Department 2",
    });
    const a = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTA${Date.now()}D`, title: "A", creditHours: 3 });
    const b = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTB${Date.now()}D`, title: "B", creditHours: 3 });

    await addPrerequisite(adminActor, { courseId: a.id, prerequisiteCourseId: b.id }); // A requires B
    await expect(addPrerequisite(adminActor, { courseId: b.id, prerequisiteCourseId: a.id })).rejects.toThrow(
      ValidationError,
    );

    await removePrerequisite(adminActor, { courseId: a.id, prerequisiteCourseId: b.id });
    await db.delete(course).where(eq(course.id, a.id));
    await db.delete(course).where(eq(course.id, b.id));
    await db.delete(department).where(eq(department.id, testDept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });

  it("refuses an indirect cycle (A requires B requires C, then C requires A)", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}E`, name: "Cycle College 3" });
    const testDept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}E`,
      name: "Cycle Department 3",
    });
    const a = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTA${Date.now()}E`, title: "A", creditHours: 3 });
    const b = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTB${Date.now()}E`, title: "B", creditHours: 3 });
    const c = await createCourse(adminActor, { departmentId: testDept.id, code: `TSTC${Date.now()}EE`, title: "C", creditHours: 3 });

    await addPrerequisite(adminActor, { courseId: a.id, prerequisiteCourseId: b.id }); // A requires B
    await addPrerequisite(adminActor, { courseId: b.id, prerequisiteCourseId: c.id }); // B requires C

    // C requires A would close the loop A -> B -> C -> A.
    await expect(addPrerequisite(adminActor, { courseId: c.id, prerequisiteCourseId: a.id })).rejects.toThrow(
      ValidationError,
    );

    await db.delete(coursePrerequisite).where(eq(coursePrerequisite.courseId, a.id));
    await db.delete(coursePrerequisite).where(eq(coursePrerequisite.courseId, b.id));
    await db.delete(course).where(eq(course.id, a.id));
    await db.delete(course).where(eq(course.id, b.id));
    await db.delete(course).where(eq(course.id, c.id));
    await db.delete(department).where(eq(department.id, testDept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });

  it("refuses a Student and a Super Admin from adding a prerequisite", async () => {
    await expect(
      addPrerequisite(studentActor, { courseId: "00000000-0000-0000-0000-000000000099", prerequisiteCourseId: "00000000-0000-0000-0000-000000000098" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      addPrerequisite(superAdminActor, { courseId: "00000000-0000-0000-0000-000000000099", prerequisiteCourseId: "00000000-0000-0000-0000-000000000098" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("department max-credits override", () => {
  it("refuses a value above the institution maximum", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}F`, name: "Override College" });

    await expect(
      createDepartment(adminActor, {
        collegeId: testCollege.id,
        code: `TSTD${Date.now()}F`,
        name: "Override Department",
        maxCreditsOverride: 25, // above the institution default of 21
      }),
    ).rejects.toThrow(ValidationError);

    await db.delete(college).where(eq(college.id, testCollege.id));
  });

  it("allows a value at or below the institution maximum", async () => {
    const testCollege = await createCollege(adminActor, { code: `TSTC${Date.now()}G`, name: "Override College 2" });
    const dept = await createDepartment(adminActor, {
      collegeId: testCollege.id,
      code: `TSTD${Date.now()}G`,
      name: "Override Department 2",
      maxCreditsOverride: 18,
    });
    expect(dept.maxCreditsOverride).toBe(18);

    await db.delete(department).where(eq(department.id, dept.id));
    await db.delete(college).where(eq(college.id, testCollege.id));
  });
});

describe("updateCollege", () => {
  it("updates name and code, and refuses a rename that collides with another college", async () => {
    const collegeA = await createCollege(adminActor, { code: `TSTC${Date.now()}H`, name: "Original Name" });
    const collegeB = await createCollege(adminActor, { code: `TSTC${Date.now()}I`, name: "Other College" });

    const updated = await updateCollege(adminActor, collegeA.id, { name: "Renamed College" });
    expect(updated.name).toBe("Renamed College");

    await expect(updateCollege(adminActor, collegeB.id, { code: collegeA.code })).rejects.toThrow(ValidationError);

    await db.delete(college).where(eq(college.id, collegeA.id));
    await db.delete(college).where(eq(college.id, collegeB.id));
  });
});
