import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { appUser, department, student } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { resolveLoginIdentifierToEmail } from "@/lib/identity/resolve";
import { isValidStudentId } from "@/lib/identity/studentId";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/identity/temporaryPassword";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "./name";

export const STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED", "ADMISSION_FORFEITED"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export const STUDENT_GENDERS = ["MALE", "FEMALE"] as const;
export type StudentGender = (typeof STUDENT_GENDERS)[number];

export interface EnrollStudentInput {
  studentNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  /** Required at enrolment; nullable in the column for students enrolled
   *  before the field existed. */
  gender: StudentGender;
  departmentId: string;
  enrolmentYear: number;
  /** Optional secondary field of study, free text. */
  minor?: string;
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
  // Optional: an omitted or blank middle name is stored as NULL, never "".
  const middleName = input.middleName?.trim() || null;
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ValidationError("First and last name are required.");
  if (!STUDENT_GENDERS.includes(input.gender)) throw new ValidationError("Gender is required.");

  if (!Number.isInteger(input.enrolmentYear) || String(input.enrolmentYear) !== studentNumber.slice(0, 4)) {
    throw new ValidationError("Enrolment year must match the admission year encoded in the Student ID.");
  }

  const dept = await db.query.department.findFirst({ where: eq(department.id, input.departmentId) });
  if (!dept) throw new ValidationError("Department not found.");
  if (!dept.isActive) throw new ValidationError("Cannot enrol into an inactive department.");

  const email = resolveLoginIdentifierToEmail(studentNumber);
  const temporaryPassword = generateTemporaryPassword();
  const contactPhone = input.contactPhone?.trim() || null;
  const minor = input.minor?.trim() || null;

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
        displayName: fullName({ firstName, middleName, lastName }),
        role: "STUDENT",
        status: "ACTIVE",
        mustChangePassword: true,
        createdBy: actor.userId,
      });
      await tx.insert(student).values({
        id: data.user.id,
        studentNumber,
        firstName,
        middleName,
        lastName,
        gender: input.gender,
        departmentId: input.departmentId,
        enrolmentYear: input.enrolmentYear,
        minor,
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
          middleName,
          lastName,
          gender: input.gender,
          departmentId: input.departmentId,
          enrolmentYear: input.enrolmentYear,
          minor,
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
  /**
   * The Student ID. Editable by an Admin (correcting a typo, or an ID
   * issued wrongly), but it is not an ordinary column: it is also the
   * student's login identifier and the seed of their synthetic Auth email,
   * so changing it moves three things at once. See `changeStudentNumber`.
   */
  studentNumber?: string;
  firstName?: string;
  /** `null` clears a recorded middle name; `undefined` leaves it as it is. */
  middleName?: string | null;
  lastName?: string;
  gender?: StudentGender;
  departmentId?: string;
  enrolmentYear?: number;
  /** `null` clears a recorded minor; `undefined` leaves it as it is. */
  minor?: string | null;
  contactPhone?: string | null;
  status?: StudentStatus;
}

/**
 * Moves a Student ID, and everything that is derived from it, together.
 *
 * A Student ID is three things in this system: `student.student_number`,
 * `app_user.login_identifier`, and -- via resolveLoginIdentifierToEmail --
 * the synthetic email of the Supabase Auth user. Change one and leave the
 * others and the student silently cannot sign in, which is the failure
 * this function exists to make impossible.
 *
 * Two of the three are rows in Postgres and move in one transaction. The
 * third is an external service that cannot join it, so the ordering is the
 * same compensating pattern `enrollStudent` uses: change Auth first,
 * because that is the step we can undo, then the database; if the database
 * write fails, put the Auth email back before rethrowing.
 *
 * Uniqueness is the database's rule, not this function's guess: 0009's
 * `student_number_unique_idx` is UNIQUE on `trim(student_number)`, so the
 * pre-check below is a courtesy that produces a readable message, and the
 * 23505 handler is what actually guarantees it under a concurrent edit.
 *
 * Note what is deliberately NOT enforced here: enrolment does require the
 * ID's first four digits to match the enrolment year, but an edit does
 * not. Confirmed with the owner -- an Admin fixing a mis-typed admission
 * year needs to change one field at a time, and the year is separately
 * editable on the same form.
 */
async function changeStudentNumber(
  actor: Actor,
  studentId: string,
  oldNumber: string,
  newNumber: string,
): Promise<void> {
  if (!isValidStudentId(newNumber)) {
    throw new ValidationError('Student ID must be digits only, starting with the admission year (e.g. "202634").');
  }

  const clash = await db.query.student.findFirst({
    where: and(eq(student.studentNumber, newNumber), sql`${student.id} <> ${studentId}`),
  });
  if (clash) throw new ValidationError(`Student ID "${newNumber}" is already in use.`);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(studentId, {
    email: resolveLoginIdentifierToEmail(newNumber),
  });
  if (error) {
    if (error.message?.toLowerCase().includes("already")) {
      throw new ValidationError(`Student ID "${newNumber}" is already in use.`);
    }
    throw new Error(`Failed to update the sign-in account: ${error.message}`);
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(student).set({ studentNumber: newNumber }).where(eq(student.id, studentId));
      await tx.update(appUser).set({ loginIdentifier: newNumber }).where(eq(appUser.id, studentId));
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "STUDENT_NUMBER_CHANGED",
        entityType: "student",
        entityId: studentId,
        oldValue: { studentNumber: oldNumber },
        newValue: { studentNumber: newNumber },
      });
    });
  } catch (err) {
    // Put the sign-in account back the way it was, so a failed edit leaves
    // the student able to log in with the ID they still have.
    await admin.auth.admin
      .updateUserById(studentId, { email: resolveLoginIdentifierToEmail(oldNumber) })
      .catch(() => {});
    if (isUniqueViolation(err)) {
      throw new ValidationError(`Student ID "${newNumber}" is already in use.`);
    }
    throw err;
  }
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

  // Done before the field diff below, and separately from it, because it is
  // the one edit on this form that also touches Supabase Auth. If it throws,
  // nothing else has been written yet.
  const requestedNumber = input.studentNumber?.trim();
  if (requestedNumber && requestedNumber !== existing.studentNumber) {
    await changeStudentNumber(actor, studentId, existing.studentNumber, requestedNumber);
  }

  if (input.departmentId && input.departmentId !== existing.departmentId) {
    const dept = await db.query.department.findFirst({ where: eq(department.id, input.departmentId) });
    if (!dept) throw new ValidationError("Department not found.");
  }

  const newFirstName = input.firstName?.trim() || existing.firstName;
  // Unlike first/last name, an empty submitted value is meaningful here: it
  // is how the form clears a middle name that was entered by mistake. So an
  // absent key falls back to the stored value, but a blank one clears it.
  const newMiddleName = input.middleName === undefined ? existing.middleName : input.middleName?.trim() || null;
  const newLastName = input.lastName?.trim() || existing.lastName;
  const newGender = input.gender ?? (existing.gender as StudentGender | null);
  const newDepartmentId = input.departmentId ?? existing.departmentId;
  const newEnrolmentYear = input.enrolmentYear ?? existing.enrolmentYear;
  // Same rule as middleName: an absent key keeps the stored value, a blank
  // one clears it.
  const newMinor = input.minor === undefined ? existing.minor : input.minor?.trim() || null;
  const newContactPhone = input.contactPhone === undefined ? existing.contactPhone : input.contactPhone;
  const newStatus = input.status ?? (existing.status as StudentStatus);

  if (input.status && !STUDENT_STATUSES.includes(input.status)) {
    throw new ValidationError(`Invalid status "${input.status}".`);
  }
  if (input.gender && !STUDENT_GENDERS.includes(input.gender)) {
    throw new ValidationError(`Invalid gender "${input.gender}".`);
  }

  const allFields: Array<[string, unknown, unknown]> = [
    ["firstName", existing.firstName, newFirstName],
    ["middleName", existing.middleName, newMiddleName],
    ["lastName", existing.lastName, newLastName],
    ["gender", existing.gender, newGender],
    ["departmentId", existing.departmentId, newDepartmentId],
    ["enrolmentYear", existing.enrolmentYear, newEnrolmentYear],
    ["minor", existing.minor, newMinor],
    ["contactPhone", existing.contactPhone, newContactPhone],
    ["status", existing.status, newStatus],
  ];
  const changedFields = allFields.filter(([, oldV, newV]) => oldV !== newV);

  if (changedFields.length === 0) {
    // The ID edit above is not one of the diffed fields, so re-read rather
    // than returning the stale snapshot when it was the only change.
    return requestedNumber && requestedNumber !== existing.studentNumber
      ? ((await db.query.student.findFirst({ where: eq(student.id, studentId) })) ?? existing)
      : existing;
  }

  const oldValue = Object.fromEntries(changedFields.map(([key, oldV]) => [key, oldV]));
  const newValue = Object.fromEntries(changedFields.map(([key, , newV]) => [key, newV]));
  const nameChanged =
    newFirstName !== existing.firstName || newMiddleName !== existing.middleName || newLastName !== existing.lastName;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(student)
      .set({
        firstName: newFirstName,
        middleName: newMiddleName,
        lastName: newLastName,
        gender: newGender,
        departmentId: newDepartmentId,
        enrolmentYear: newEnrolmentYear,
        minor: newMinor,
        contactPhone: newContactPhone,
        status: newStatus,
      })
      .where(eq(student.id, studentId))
      .returning();

    if (nameChanged) {
      await tx
        .update(appUser)
        .set({ displayName: fullName({ firstName: newFirstName, middleName: newMiddleName, lastName: newLastName }) })
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
  /**
   * Every student in any department of this college. There are far fewer
   * colleges than departments, which is why the Students listing filters
   * on this rather than on `departmentId` -- department-level detail lives
   * on the student's own profile page. `departmentId` stays supported: it
   * is the narrower filter and other callers may still want it.
   */
  collegeId?: string;
  enrolmentYear?: number;
  page?: number;
  pageSize?: number;
}

/**
 * The WHERE clause behind both the paginated listing and the export, built
 * once so a downloaded file can never describe a different set of students
 * than the screen it was downloaded from.
 */
function buildStudentWhere(tx: Tx, input: SearchStudentsInput) {
  const conditions = [];
  const trimmedQuery = input.query?.trim();
  if (trimmedQuery) {
    const q = `%${trimmedQuery}%`;
    conditions.push(
      or(
        ilike(student.studentNumber, q),
        ilike(student.firstName, q),
        ilike(student.middleName, q),
        ilike(student.lastName, q),
      ),
    );
  }
  if (input.status) {
    conditions.push(eq(student.status, input.status));
  }
  if (input.departmentId) {
    conditions.push(eq(student.departmentId, input.departmentId));
  }
  if (input.collegeId) {
    // A subquery rather than a join: `student` is the only table the
    // paginated read selects from, and adding a join would change the
    // shape of every row this function has returned since Stage 5.
    // department.college_id is indexed by the FK, and the department
    // table holds tens of rows, not thousands.
    conditions.push(
      inArray(
        student.departmentId,
        tx.select({ id: department.id }).from(department).where(eq(department.collegeId, input.collegeId)),
      ),
    );
  }
  if (input.enrolmentYear !== undefined) {
    conditions.push(eq(student.enrolmentYear, input.enrolmentYear));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
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
    const where = buildStudentWhere(tx, input);

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
 * Every student matching the same filters, unpaginated -- what the CSV
 * download and the print view act on.
 *
 * Capped rather than unbounded: the College has a few hundred students
 * (ASM-03), so a cap of 5,000 is far above any real result set and still
 * means a mistake here cannot try to build a million-row file in memory.
 * Hitting the cap is reported to the caller instead of being truncated
 * silently -- a spreadsheet that is quietly missing rows is worse than one
 * that says it is incomplete.
 */
export const EXPORT_ROW_CAP = 5000;

export async function exportStudents(actor: Actor, input: SearchStudentsInput = {}) {
  return asUser(actor.userId, async (tx) => {
    const where = buildStudentWhere(tx, input);
    const rows = await tx.query.student.findMany({
      where,
      limit: EXPORT_ROW_CAP + 1,
      orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
    });
    return { rows: rows.slice(0, EXPORT_ROW_CAP), truncated: rows.length > EXPORT_ROW_CAP };
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
