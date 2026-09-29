import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, auditLog, department, student } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/identity/temporaryPassword";
import { fullName, listName } from "@/lib/students/name";

/**
 * Login slips: the students' sign-in details on paper, to cut and hand out.
 *
 * A temporary password is never stored -- Supabase keeps only its hash, and
 * the screen that issues one shows it once. So a slip cannot be printed
 * from a password issued earlier; printing a slip ISSUES a new one (the
 * College's choice, 29 Sep 2026). That makes the student's previous
 * temporary password stop working, which is why the list shows when each
 * student's password was last issued, and why the page asks before
 * printing. The new passwords go back to the Admin's screen once, for the
 * print, and nowhere else.
 *
 * Every issue is audited (LOGIN_SLIP_ISSUED) and puts the student back on
 * "must change password at first sign-in".
 */

/** Actions that hand a student a temporary password. */
const ISSUE_ACTIONS = ["STUDENT_CREATED", "PASSWORD_RESET_BY_ADMIN", "LOGIN_SLIP_ISSUED"];

/** One print run. Each password is a call to the Auth service, and the page
 *  has to come back while the Admin waits. */
export const MAX_SLIPS_PER_PRINT = 60;

export interface LoginSlipStudent {
  studentId: string;
  studentNumber: string;
  /** "Kollie, Abraham" -- for the sorted table. */
  sortName: string;
  departmentName: string;
  /** False while the student is still on a temporary password. */
  passwordChanged: boolean;
  /** When a temporary password was last issued (account created, reset or
   *  slip printed), ISO; null when the log holds none. */
  lastIssuedAt: string | null;
}

export async function listLoginSlipStudents(actor: Actor): Promise<LoginSlipStudent[]> {
  await assertCan(actor, "identity.resetStudentPassword");

  const [rows, issued] = await Promise.all([
    db
      .select({
        studentId: student.id,
        studentNumber: student.studentNumber,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        departmentName: department.name,
        mustChangePassword: appUser.mustChangePassword,
      })
      .from(student)
      .innerJoin(appUser, eq(appUser.id, student.id))
      .innerJoin(department, eq(department.id, student.departmentId))
      // A disabled account cannot sign in, so a slip for it would be useless.
      .where(and(eq(appUser.role, "STUDENT"), eq(appUser.status, "ACTIVE"))),
    db
      .select({ entityId: auditLog.entityId, at: max(auditLog.occurredAt) })
      .from(auditLog)
      .where(inArray(auditLog.action, ISSUE_ACTIONS))
      .groupBy(auditLog.entityId),
  ]);
  const lastIssued = new Map(issued.map((r) => [r.entityId, r.at]));

  return rows
    .map((r) => {
      const at = lastIssued.get(r.studentId);
      return {
        studentId: r.studentId,
        studentNumber: r.studentNumber,
        sortName: listName(r),
        departmentName: r.departmentName,
        passwordChanged: !r.mustChangePassword,
        lastIssuedAt: at ? new Date(at).toISOString() : null,
      };
    })
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.sortName.localeCompare(b.sortName));
}

export interface LoginSlip {
  studentId: string;
  studentNumber: string;
  /** "Abraham Kollie" -- as printed on the slip. */
  name: string;
  departmentName: string;
  temporaryPassword: string;
}

export interface IssueLoginSlipsResult {
  slips: LoginSlip[];
  failed: Array<{ studentNumber: string; name: string; reason: string }>;
}

/** Sets a student's Auth password. Swappable so tests need no Auth service. */
export type SetPassword = (userId: string, password: string) => Promise<void>;

const supabaseSetPassword: SetPassword = async (userId, password) => {
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(error.message);
};

/**
 * Issues a new temporary password to each student and returns them for
 * printing. One student failing does not stop the others, and a password
 * that was set is always returned -- losing one after it replaced the old
 * password would leave that student locked out.
 */
export async function issueLoginSlips(
  actor: Actor,
  studentIds: string[],
  setPassword: SetPassword = supabaseSetPassword,
): Promise<IssueLoginSlipsResult> {
  await assertCan(actor, "identity.resetStudentPassword");

  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) throw new ValidationError("Choose at least one student.");
  if (ids.length > MAX_SLIPS_PER_PRINT)
    throw new ValidationError(`Print at most ${MAX_SLIPS_PER_PRINT} slips at a time; ${ids.length} were chosen.`);

  const rows = await db
    .select({
      studentId: student.id,
      studentNumber: student.studentNumber,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      departmentName: department.name,
      mustChangePassword: appUser.mustChangePassword,
    })
    .from(student)
    .innerJoin(appUser, eq(appUser.id, student.id))
    .innerJoin(department, eq(department.id, student.departmentId))
    .where(and(inArray(student.id, ids), eq(appUser.role, "STUDENT"), eq(appUser.status, "ACTIVE")));
  if (rows.length !== ids.length) throw new ValidationError("A chosen student no longer has an active account. Refresh the list and try again.");

  const result: IssueLoginSlipsResult = { slips: [], failed: [] };
  const byId = new Map(rows.map((r) => [r.studentId, r]));
  // In the order the list showed them, a few at a time.
  const queue = ids.map((id) => byId.get(id)!);
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const temporaryPassword = generateTemporaryPassword();
      try {
        await setPassword(r.studentId, temporaryPassword);
      } catch (err) {
        result.failed.push({ studentNumber: r.studentNumber, name: fullName(r), reason: err instanceof Error ? err.message : "Unknown error" });
        continue;
      }
      await db.transaction(async (tx) => {
        await tx.update(appUser).set({ mustChangePassword: true }).where(eq(appUser.id, r.studentId));
        await auditWrite(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: "LOGIN_SLIP_ISSUED",
          entityType: "app_user",
          entityId: r.studentId,
          studentId: r.studentId,
          newValue: { studentNumber: r.studentNumber, passwordWasChanged: !r.mustChangePassword },
        });
      });
      result.slips.push({ studentId: r.studentId, studentNumber: r.studentNumber, name: fullName(r), departmentName: r.departmentName, temporaryPassword });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));

  const order = new Map(ids.map((id, i) => [id, i]));
  result.slips.sort((a, b) => order.get(a.studentId)! - order.get(b.studentId)!);
  return result;
}
