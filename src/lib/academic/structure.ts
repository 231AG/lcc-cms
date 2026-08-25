import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { college, department, course, coursePrerequisite, institutionSetting } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, " ");
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function isForeignKeyViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23503";
}

// ---------------------------------------------------------------------------
// College
// ---------------------------------------------------------------------------

export async function createCollege(actor: Actor, input: { code: string; name: string }) {
  await assertCan(actor, "structure.manageCollege");
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!code || !name) throw new ValidationError("Code and name are required.");

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx.insert(college).values({ code, name }).returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COLLEGE_CREATED",
        entityType: "college",
        entityId: row.id,
        newValue: { code, name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A college with code "${code}" already exists.`);
    throw err;
  }
}

export async function updateCollege(
  actor: Actor,
  collegeId: string,
  input: { code?: string; name?: string },
) {
  await assertCan(actor, "structure.manageCollege");

  const existing = await db.query.college.findFirst({ where: eq(college.id, collegeId) });
  if (!existing) throw new ValidationError("College not found.");

  const newCode = input.code ? normalizeCode(input.code) : existing.code;
  const newName = input.name?.trim() ?? existing.name;

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .update(college)
        .set({ code: newCode, name: newName })
        .where(eq(college.id, collegeId))
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COLLEGE_UPDATED",
        entityType: "college",
        entityId: collegeId,
        oldValue: { code: existing.code, name: existing.name },
        newValue: { code: newCode, name: newName },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A college with code "${newCode}" already exists.`);
    throw err;
  }
}

export async function setCollegeActive(actor: Actor, collegeId: string, isActive: boolean) {
  await assertCan(actor, "structure.manageCollege");

  const existing = await db.query.college.findFirst({ where: eq(college.id, collegeId) });
  if (!existing) throw new ValidationError("College not found.");

  if (!isActive) {
    const activeDepartments = await db.query.department.findMany({
      where: and(eq(department.collegeId, collegeId), eq(department.isActive, true)),
    });
    if (activeDepartments.length > 0) {
      throw new ValidationError(
        `Cannot deactivate: ${activeDepartments.length} active department(s) still belong to this college (${activeDepartments
          .map((d) => d.code)
          .join(", ")}). Deactivate them first.`,
      );
    }
  }

  await asUser(actor.userId, async (tx) => {
    await tx.update(college).set({ isActive }).where(eq(college.id, collegeId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: isActive ? "COLLEGE_REACTIVATED" : "COLLEGE_DEACTIVATED",
      entityType: "college",
      entityId: collegeId,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
    });
  });
}

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

export async function createDepartment(
  actor: Actor,
  input: { collegeId: string; code: string; name: string; maxCreditsOverride?: number },
) {
  await assertCan(actor, "structure.manageDepartment");
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!code || !name) throw new ValidationError("Code and name are required.");

  if (input.maxCreditsOverride !== undefined) {
    await assertMaxCreditsOverrideIsValid(input.maxCreditsOverride);
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(department)
        .values({
          collegeId: input.collegeId,
          code,
          name,
          maxCreditsOverride: input.maxCreditsOverride ?? null,
        })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "DEPARTMENT_CREATED",
        entityType: "department",
        entityId: row.id,
        newValue: { collegeId: input.collegeId, code, name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A department with code "${code}" already exists in this college.`);
    if (isForeignKeyViolation(err)) throw new ValidationError("That college does not exist.");
    throw err;
  }
}

async function assertMaxCreditsOverrideIsValid(value: number): Promise<void> {
  const setting = await db.query.institutionSetting.findFirst({
    where: eq(institutionSetting.key, "max_credits_per_semester"),
  });
  const institutionMax = (setting?.value as number | undefined) ?? 21;
  if (value > institutionMax) {
    throw new ValidationError(
      `A department's credit-hour ceiling may not exceed the institution maximum of ${institutionMax}.`,
    );
  }
  if (value < 1) {
    throw new ValidationError("A department's credit-hour ceiling must be at least 1.");
  }
}

export async function updateDepartment(
  actor: Actor,
  departmentId: string,
  input: { code?: string; name?: string; maxCreditsOverride?: number | null },
) {
  await assertCan(actor, "structure.manageDepartment");

  const existing = await db.query.department.findFirst({ where: eq(department.id, departmentId) });
  if (!existing) throw new ValidationError("Department not found.");

  if (input.maxCreditsOverride !== undefined && input.maxCreditsOverride !== null) {
    await assertMaxCreditsOverrideIsValid(input.maxCreditsOverride);
  }

  const newCode = input.code ? normalizeCode(input.code) : existing.code;
  const newName = input.name?.trim() ?? existing.name;
  const newMaxCredits = input.maxCreditsOverride === undefined ? existing.maxCreditsOverride : input.maxCreditsOverride;

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .update(department)
        .set({ code: newCode, name: newName, maxCreditsOverride: newMaxCredits })
        .where(eq(department.id, departmentId))
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "DEPARTMENT_UPDATED",
        entityType: "department",
        entityId: departmentId,
        oldValue: { code: existing.code, name: existing.name, maxCreditsOverride: existing.maxCreditsOverride },
        newValue: { code: newCode, name: newName, maxCreditsOverride: newMaxCredits },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A department with code "${newCode}" already exists in this college.`);
    throw err;
  }
}

export async function setDepartmentActive(actor: Actor, departmentId: string, isActive: boolean) {
  await assertCan(actor, "structure.manageDepartment");

  const existing = await db.query.department.findFirst({ where: eq(department.id, departmentId) });
  if (!existing) throw new ValidationError("Department not found.");

  // Stage 5 will extend this check to also refuse deactivation while the
  // department has ACTIVE students (Section 9.4.3) -- the student table
  // doesn't exist yet at this stage.
  if (!isActive) {
    const activeCourses = await db.query.course.findMany({
      where: and(eq(course.departmentId, departmentId), eq(course.isActive, true)),
    });
    if (activeCourses.length > 0) {
      throw new ValidationError(
        `Cannot deactivate: ${activeCourses.length} active course(s) still belong to this department (${activeCourses
          .map((c) => c.code)
          .join(", ")}). Deactivate them first.`,
      );
    }
  }

  await asUser(actor.userId, async (tx) => {
    await tx.update(department).set({ isActive }).where(eq(department.id, departmentId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: isActive ? "DEPARTMENT_REACTIVATED" : "DEPARTMENT_DEACTIVATED",
      entityType: "department",
      entityId: departmentId,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
    });
  });
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export async function createCourse(
  actor: Actor,
  input: { departmentId: string; code: string; title: string; creditHours: number },
) {
  await assertCan(actor, "structure.manageCourse");
  const code = normalizeCode(input.code);
  const title = input.title.trim();
  if (!code || !title) throw new ValidationError("Code and title are required.");
  if (!Number.isInteger(input.creditHours) || input.creditHours <= 0) {
    throw new ValidationError("Credit hours must be a whole number greater than zero.");
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(course)
        .values({ departmentId: input.departmentId, code, title, creditHours: input.creditHours })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COURSE_CREATED",
        entityType: "course",
        entityId: row.id,
        newValue: { departmentId: input.departmentId, code, title, creditHours: input.creditHours },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A course with code "${code}" already exists.`);
    if (isForeignKeyViolation(err)) throw new ValidationError("That department does not exist.");
    throw err;
  }
}

export async function updateCourse(
  actor: Actor,
  courseId: string,
  input: { code?: string; title?: string; creditHours?: number },
) {
  await assertCan(actor, "structure.manageCourse");

  const existing = await db.query.course.findFirst({ where: eq(course.id, courseId) });
  if (!existing) throw new ValidationError("Course not found.");

  const newCode = input.code ? normalizeCode(input.code) : existing.code;
  const newTitle = input.title?.trim() ?? existing.title;
  const newCreditHours = input.creditHours ?? existing.creditHours;

  if (!Number.isInteger(newCreditHours) || newCreditHours <= 0) {
    throw new ValidationError("Credit hours must be a whole number greater than zero.");
  }

  const creditHoursChanged = newCreditHours !== existing.creditHours;

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .update(course)
        .set({ code: newCode, title: newTitle, creditHours: newCreditHours })
        .where(eq(course.id, courseId))
        .returning();

      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COURSE_UPDATED",
        entityType: "course",
        entityId: courseId,
        oldValue: { code: existing.code, title: existing.title, creditHours: existing.creditHours },
        newValue: { code: newCode, title: newTitle, creditHours: newCreditHours },
      });

      // Logged as its own action too, distinct from a general update,
      // because of its academic significance (Section 9.4.4): existing
      // academic records freeze their own credit hours (DER-07) and are
      // never affected by this, but the change itself deserves to be easy
      // to find in the audit log without reading every course edit.
      if (creditHoursChanged) {
        await auditWrite(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "COURSE_CREDIT_HOURS_CHANGED",
          entityType: "course",
          entityId: courseId,
          oldValue: { creditHours: existing.creditHours },
          newValue: { creditHours: newCreditHours },
          reason: "Existing academic records are unaffected -- they store frozen credit hours (DER-07).",
        });
      }

      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`A course with code "${newCode}" already exists.`);
    throw err;
  }
}

export async function setCourseActive(actor: Actor, courseId: string, isActive: boolean) {
  await assertCan(actor, "structure.manageCourse");

  const existing = await db.query.course.findFirst({ where: eq(course.id, courseId) });
  if (!existing) throw new ValidationError("Course not found.");

  await asUser(actor.userId, async (tx) => {
    await tx.update(course).set({ isActive }).where(eq(course.id, courseId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: isActive ? "COURSE_REACTIVATED" : "COURSE_DEACTIVATED",
      entityType: "course",
      entityId: courseId,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
    });
  });
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

/**
 * Checks whether adding `courseId requires prerequisiteCourseId` would
 * create a cycle: true if prerequisiteCourseId can already (transitively)
 * reach courseId through existing "requires" edges, meaning courseId is
 * already, directly or indirectly, a prerequisite of prerequisiteCourseId.
 */
async function wouldCreateCycle(courseId: string, prerequisiteCourseId: string): Promise<string[] | null> {
  const rows = await db.execute<{ node: string; path: string[] }>(sql`
    WITH RECURSIVE reach AS (
      SELECT prerequisite_course_id AS node, ARRAY[course_id, prerequisite_course_id] AS path
      FROM app.course_prerequisite
      WHERE course_id = ${prerequisiteCourseId}
      UNION ALL
      SELECT cp.prerequisite_course_id, reach.path || cp.prerequisite_course_id
      FROM app.course_prerequisite cp
      JOIN reach ON cp.course_id = reach.node
      WHERE NOT cp.prerequisite_course_id = ANY(reach.path)
    )
    SELECT node, path FROM reach WHERE node = ${courseId}
  `);
  const row = rows[0] as unknown as { path: string[] } | undefined;
  return row ? row.path : null;
}

export async function addPrerequisite(
  actor: Actor,
  input: { courseId: string; prerequisiteCourseId: string; minGrade?: string },
) {
  await assertCan(actor, "structure.managePrerequisite");

  if (input.courseId === input.prerequisiteCourseId) {
    throw new ValidationError("A course cannot be its own prerequisite.");
  }

  const [target, prereq] = await Promise.all([
    db.query.course.findFirst({ where: eq(course.id, input.courseId) }),
    db.query.course.findFirst({ where: eq(course.id, input.prerequisiteCourseId) }),
  ]);
  if (!target || !prereq) throw new ValidationError("Course not found.");

  const cyclePath = await wouldCreateCycle(input.courseId, input.prerequisiteCourseId);
  if (cyclePath) {
    throw new ValidationError(
      `Adding this prerequisite would create a cycle: ${prereq.code} already (transitively) requires ${target.code}.`,
    );
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(coursePrerequisite)
        .values({
          courseId: input.courseId,
          prerequisiteCourseId: input.prerequisiteCourseId,
          minGrade: input.minGrade ?? null,
        })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "PREREQUISITE_ADDED",
        entityType: "course_prerequisite",
        entityId: `${input.courseId}:${input.prerequisiteCourseId}`,
        newValue: { course: target.code, prerequisite: prereq.code },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError(`${prereq.code} is already a prerequisite of ${target.code}.`);
    }
    throw err;
  }
}

export async function removePrerequisite(
  actor: Actor,
  input: { courseId: string; prerequisiteCourseId: string },
) {
  await assertCan(actor, "structure.managePrerequisite");

  await asUser(actor.userId, async (tx) => {
    await tx
      .delete(coursePrerequisite)
      .where(
        and(
          eq(coursePrerequisite.courseId, input.courseId),
          eq(coursePrerequisite.prerequisiteCourseId, input.prerequisiteCourseId),
        ),
      );
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "PREREQUISITE_REMOVED",
      entityType: "course_prerequisite",
      entityId: `${input.courseId}:${input.prerequisiteCourseId}`,
      oldValue: { courseId: input.courseId, prerequisiteCourseId: input.prerequisiteCourseId },
    });
  });
}
