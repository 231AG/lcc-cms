import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { appUser, department, student } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { resolveLoginIdentifierToEmail } from "@/lib/identity/resolve";
import { isValidStudentId } from "@/lib/identity/studentId";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED", "ADMISSION_FORFEITED"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

function generateTemporaryPassword(): string {
  return randomBytes(16).toString("base64url");
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export interface EnrollStudentInput {
  studentNumber: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  enrolmentYear: number;
  contactPhone?: string;
}

/**
 * REQ-T02: creates the Supabase Auth user, app_user, and student rows as
 * one semantic event. The Auth user is created first via the Admin API
 * (external, non-transactional), then app_user + student are written
 * together in one Postgres transaction, matching createStaffAccount's
 * pattern -- but here, unlike that function, a DB-side failure also
 * deletes the just-created Auth user, so a failure genuinely "leaves
 * neither user nor profile" (Section 24.6's acceptance criterion), not an
 * orphaned Auth account with no matching row.
 */
export async function enrollStudent(
  actor: Actor,
  input: EnrollStudentInput,
): Promise<{ studentNumber: string; temporaryPassword: string }> {
  await assertCan(actor, "identity.createStudentAccount");

  const studentNumber = input.studentNumber.trim();
  if (!isValidStudentId(studentNumber)) {
    throw new ValidationError('Student ID must be digits only, starting with the admission year (e.g. "202634").');
  }
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ValidationError("First and last name are required.");

  if (!Number.isInteger(input.enrolmentYear) || String(input.enrolmentYear) !== studentNumber.slice(0, 4)) {
    throw new ValidationError("Enrolment year must match the admission year encoded in the Student ID.");
  }

  const dept = await db.query.department.findFirst({ where: eq(department.id, input.departmentId) });
  if (!dept) throw new ValidationError("Department not found.");
  if (!dept.isActive) throw new ValidationError("Cannot enrol into an inactive department.");

  const email = resolveLoginIdentifierToEmail(studentNumber);
  const temporaryPassword = generateTemporaryPassword();
  const contactPhone = input.contactPhone?.trim() || null;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("already")) {
      throw new ValidationError(`Student ID "${studentNumber}" is already in use.`);
    }
    throw new Error(`Failed to create account: ${error?.message}`);
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(appUser).values({
        id: data.user.id,
        loginIdentifier: studentNumber,
        displayName: `${firstName} ${lastName}`,
        role: "STUDENT",
        status: "ACTIVE",
        mustChangePassword: true,
        createdBy: actor.userId,
      });
      await tx.insert(student).values({
        id: data.user.id,
        studentNumber,
        firstName,
        lastName,
        departmentId: input.departmentId,
        enrolmentYear: input.enrolmentYear,
        contactPhone,
        createdBy: actor.userId,
      });
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "STUDENT_CREATED",
        entityType: "student",
        entityId: data.user.id,
        newValue: {
          studentNumber,
          firstName,
          lastName,
          departmentId: input.departmentId,
          enrolmentYear: input.enrolmentYear,
        },
      });
    });
  } catch (err) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    if (isUniqueViolation(err)) {
      throw new ValidationError(`Student ID "${studentNumber}" is already in use.`);
    }
    throw err;
  }

  return { studentNumber, temporaryPassword };
}

// ---------------------------------------------------------------------------
// Profile edits and status changes
// ---------------------------------------------------------------------------

export interface UpdateStudentProfileInput {
  firstName?: string;
  lastName?: string;
  departmentId?: string;
  enrolmentYear?: number;
  contactPhone?: string | null;
  status?: StudentStatus;
}

/**
 * One function for every field on the record, including status (Section
 * 9.4.2's "status change" and "department change" are both just field
 * changes here) -- REQ-R04 gates all of it to Admin only, including
 * reactivating a forfeited/inactive student (DEV-04: confirmed Admin-only,
 * no Super Admin exception).
 */
export async function updateStudentProfile(
  actor: Actor,
  studentId: string,
  input: UpdateStudentProfileInput,
) {
  await assertCan(actor, "identity.updateStudentProfile");

  const existing = await db.query.student.findFirst({ where: eq(student.id, studentId) });
  if (!existing) throw new ValidationError("Student not found.");

  if (input.departmentId && input.departmentId !== existing.departmentId) {
    const dept = await db.query.department.findFirst({ where: eq(department.id, input.departmentId) });
    if (!dept) throw new ValidationError("Department not found.");
  }

  const newFirstName = input.firstName?.trim() || existing.firstName;
  const newLastName = input.lastName?.trim() || existing.lastName;
  const newDepartmentId = input.departmentId ?? existing.departmentId;
  const newEnrolmentYear = input.enrolmentYear ?? existing.enrolmentYear;
  const newContactPhone = input.contactPhone === undefined ? existing.contactPhone : input.contactPhone;
  const newStatus = input.status ?? (existing.status as StudentStatus);

  if (input.status && !STUDENT_STATUSES.includes(input.status)) {
    throw new ValidationError(`Invalid status "${input.status}".`);
  }

  const allFields: Array<[string, unknown, unknown]> = [
    ["firstName", existing.firstName, newFirstName],
    ["lastName", existing.lastName, newLastName],
    ["departmentId", existing.departmentId, newDepartmentId],
    ["enrolmentYear", existing.enrolmentYear, newEnrolmentYear],
    ["contactPhone", existing.contactPhone, newContactPhone],
    ["status", existing.status, newStatus],
  ];
  const changedFields = allFields.filter(([, oldV, newV]) => oldV !== newV);

  if (changedFields.length === 0) {
    return existing;
  }

  const oldValue = Object.fromEntries(changedFields.map(([key, oldV]) => [key, oldV]));
  const newValue = Object.fromEntries(changedFields.map(([key, , newV]) => [key, newV]));
  const nameChanged = newFirstName !== existing.firstName || newLastName !== existing.lastName;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(student)
      .set({
        firstName: newFirstName,
        lastName: newLastName,
        departmentId: newDepartmentId,
        enrolmentYear: newEnrolmentYear,
        contactPhone: newContactPhone,
        status: newStatus,
      })
      .where(eq(student.id, studentId))
      .returning();

    if (nameChanged) {
      await tx
        .update(appUser)
        .set({ displayName: `${newFirstName} ${newLastName}` })
        .where(eq(appUser.id, studentId));
    }

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "STUDENT_UPDATED",
      entityType: "student",
      entityId: studentId,
      oldValue,
      newValue,
    });

    return row;
  });
}

export async function resetStudentPassword(
  actor: Actor,
  studentId: string,
): Promise<{ temporaryPassword: string }> {
  await assertCan(actor, "identity.resetStudentPassword");

  const existing = await db.query.appUser.findFirst({
    where: and(eq(appUser.id, studentId), eq(appUser.role, "STUDENT")),
  });
  if (!existing) throw new ValidationError("Student account not found.");

  const temporaryPassword = generateTemporaryPassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(studentId, { password: temporaryPassword });
  if (error) throw new Error(`Failed to reset password: ${error.message}`);

  await db.transaction(async (tx) => {
    await tx.update(appUser).set({ mustChangePassword: true }).where(eq(appUser.id, studentId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "PASSWORD_RESET_BY_ADMIN",
      entityType: "app_user",
      entityId: studentId,
    });
  });

  return { temporaryPassword };
}

// ---------------------------------------------------------------------------
// Reads (RLS-scoped, not assertCan-gated -- Section 18.4)
// ---------------------------------------------------------------------------

export interface SearchStudentsInput {
  query?: string;
  status?: StudentStatus;
  /** Filters combine with AND, and with `query`/`status`. */
  departmentId?: string;
  enrolmentYear?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Runs through asUser() so RLS does the actual scoping: a Student sees
 * only their own row, Admin/Super Admin see everything (Section 10.5). No
 * assertCan gate here -- callers (the A-09/X-07 pages) decide what
 * controls to render for the signed-in role; RLS is what makes the
 * isolation real regardless of what the page does or doesn't render
 * (Section 18.4's "service-layer scoping plus RLS").
 */
export async function searchStudents(actor: Actor, input: SearchStudentsInput = {}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  return asUser(actor.userId, async (tx) => {
    const conditions = [];
    const trimmedQuery = input.query?.trim();
    if (trimmedQuery) {
      const q = `%${trimmedQuery}%`;
      conditions.push(
        or(ilike(student.studentNumber, q), ilike(student.firstName, q), ilike(student.lastName, q)),
      );
    }
    if (input.status) {
      conditions.push(eq(student.status, input.status));
    }
    if (input.departmentId) {
      conditions.push(eq(student.departmentId, input.departmentId));
    }
    if (input.enrolmentYear !== undefined) {
      conditions.push(eq(student.enrolmentYear, input.enrolmentYear));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      tx.query.student.findMany({
        where,
        limit: pageSize,
        offset,
        orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
      }),
      tx.select({ count: sql<number>`count(*)::int` }).from(student).where(where ?? sql`true`),
    ]);

    return { rows, total: countRows[0]?.count ?? 0, page, pageSize };
  });
}

/**
 * The enrolment years that actually have students, newest first -- so the
 * Students page's year filter offers only values that can return a result,
 * rather than a hardcoded or open-ended range. Derived from the existing
 * `enrolment_year` column; there is no separate year table and this adds
 * none. RLS-scoped like every other read here, so a Student sees only
 * their own year and staff see all of them.
 */
export async function getEnrolmentYears(actor: Actor): Promise<number[]> {
  const rows = await asUser(actor.userId, (tx) =>
    tx
      .selectDistinct({ year: student.enrolmentYear })
      .from(student)
      .orderBy(desc(student.enrolmentYear)),
  );
  return rows.map((r) => r.year);
}

export async function getStudent(actor: Actor, studentId: string) {
  const row = await asUser(actor.userId, (tx) => tx.query.student.findFirst({ where: eq(student.id, studentId) }));
  if (!row) throw new NotFoundError("Student not found.");
  return row;
}
