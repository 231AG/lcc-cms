import { and, eq, ne } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { academicYear, courseOffering, semester } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError, ForbiddenError, StateError } from "@/lib/errors";
import {
  findTransitionRule,
  isDeletable,
  legalNextStates,
  reasonRequiredFor,
  SEMESTER_STATE_LABEL,
  type SemesterState,
} from "./semesterStateMachine";

const ACADEMIC_YEAR_LABEL_PATTERN = /^(\d{4})\/(\d{4})$/;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// Academic year
// ---------------------------------------------------------------------------

export async function createAcademicYear(
  actor: Actor,
  input: { label: string; startDate: string; endDate: string },
) {
  await assertCan(actor, "calendar.manageAcademicYear");

  const match = ACADEMIC_YEAR_LABEL_PATTERN.exec(input.label.trim());
  if (!match) throw new ValidationError('Academic year label must look like "2026/2027".');
  const [, first, second] = match;
  if (Number(second) !== Number(first) + 1) {
    throw new ValidationError(`"${input.label}" is not two consecutive years (expected ${Number(first)}/${Number(first) + 1}).`);
  }
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw new ValidationError("End date must be after start date.");
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(academicYear)
        .values({ label: input.label.trim(), startDate: input.startDate, endDate: input.endDate })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "ACADEMIC_YEAR_CREATED",
        entityType: "academic_year",
        entityId: row.id,
        newValue: { label: row.label, startDate: input.startDate, endDate: input.endDate },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`Academic year "${input.label}" already exists.`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------

export async function createSemester(
  actor: Actor,
  input: { academicYearId: string; sequence: 1 | 2; name: string; startDate: string; endDate: string },
) {
  await assertCan(actor, "calendar.manageSemester");

  const year = await db.query.academicYear.findFirst({ where: eq(academicYear.id, input.academicYearId) });
  if (!year) throw new ValidationError("Academic year not found.");

  if (new Date(input.startDate) < new Date(year.startDate) || new Date(input.endDate) > new Date(year.endDate)) {
    throw new ValidationError("Semester dates must fall within the parent academic year.");
  }
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw new ValidationError("End date must be after start date.");
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(semester)
        .values({
          academicYearId: input.academicYearId,
          sequence: input.sequence,
          name: input.name.trim(),
          state: "DRAFT",
          startDate: input.startDate,
          endDate: input.endDate,
        })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "SEMESTER_CREATED",
        entityType: "semester",
        entityId: row.id,
        newValue: { academicYearId: input.academicYearId, sequence: input.sequence, name: input.name },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError(`Sequence ${input.sequence} already exists for this academic year.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// State transitions (Section 13)
// ---------------------------------------------------------------------------

export interface TransitionSemesterInput {
  semesterId: string;
  toState: SemesterState;
  reason?: string;
}

/**
 * The one way a semester's state ever changes.
 *
 * Under the four-state model BOTH staff roles may move a semester forward
 * -- changing a semester's state is a separate power from creating one,
 * which stays Admin-only (`calendar.manageSemester`). The reason field is
 * required of an Admin and optional for a Super Admin, except on the
 * Closed -> In Progress reopen, where it is mandatory for anyone and is the
 * whole point of the audit record.
 */
export async function transitionSemester(actor: Actor, input: TransitionSemesterInput) {
  await assertCan(actor, "calendar.transitionSemester");

  const current = await db.query.semester.findFirst({ where: eq(semester.id, input.semesterId) });
  if (!current) throw new ValidationError("Semester not found.");

  const fromState = current.state as SemesterState;
  if (fromState === input.toState) {
    throw new StateError(`This semester is already ${SEMESTER_STATE_LABEL[fromState]}.`);
  }

  const rule = findTransitionRule(fromState, input.toState);
  if (!rule) {
    const legal = legalNextStates(fromState).map((r) => SEMESTER_STATE_LABEL[r.to]);
    throw new StateError(
      legal.length > 0
        ? `Cannot move a ${SEMESTER_STATE_LABEL[fromState]} semester to ${SEMESTER_STATE_LABEL[input.toState]}. ` +
          `The lifecycle is forward-only; legal next state(s): ${legal.join(", ")}.`
        : `Cannot move a ${SEMESTER_STATE_LABEL[fromState]} semester to ${SEMESTER_STATE_LABEL[input.toState]}.`,
    );
  }

  if (!(rule.actorRoles as readonly string[]).includes(actor.role)) {
    throw new ForbiddenError(
      `Moving a semester from ${SEMESTER_STATE_LABEL[fromState]} to ${SEMESTER_STATE_LABEL[input.toState]} ` +
        `requires the ${rule.actorRoles.join(" or ")} role.`,
    );
  }

  const reason = input.reason?.trim() || undefined;
  if (reasonRequiredFor(rule, actor.role) && !reason) {
    throw new ValidationError(
      rule.isReopen
        ? "Reopening a closed semester requires a reason. It is recorded in the audit log before any change is permitted."
        : "A reason is required for this change.",
    );
  }

  await assertGuardConditions(current, rule.to);

  // REQ-A05 / Section 10.5: RLS only grants UPDATE on `semester` to the
  // ADMIN role. A Super Admin's transition is therefore performed through
  // the superuser connection, not asUser() -- this is the "explicitly
  // elevated, audited path" the plan calls for, not a bypass of
  // authorization (assertCan and the role/rule checks above already gated
  // this before a single row was touched).
  const runAs: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> =
    actor.role === "ADMIN" ? (fn) => asUser(actor.userId, fn) : (fn) => db.transaction(fn);

  return runAs(async (tx) => {
    const [row] = await tx
      .update(semester)
      .set({ state: input.toState })
      .where(eq(semester.id, input.semesterId))
      .returning();

    // Written in the SAME transaction as the state change, so on a reopen
    // the audit record provably exists before anything can be modified
    // under the reopened semester -- there is no window in which the
    // semester is open again but the reason for it is not yet recorded.
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "SEMESTER_STATE_CHANGED",
      entityType: "semester",
      entityId: input.semesterId,
      oldValue: { state: fromState },
      newValue: { state: input.toState, reopened: rule.isReopen },
      reason: reason ?? null,
    });

    return row;
  });
}

/**
 * Deleting a semester, which is possible only while it is still a Draft.
 *
 * Draft means nothing has ever been visible to a student and, by the state
 * machine, no plan, registration or grade can exist -- so a Draft is the
 * one point in the lifecycle where a semester created by mistake can be
 * removed rather than left cluttering the calendar forever. Anything past
 * Draft is history and is kept.
 *
 * Admin-only, under the same permission as creating one: this is the
 * undo of `createSemester`, not a state change.
 */
export async function deleteSemester(actor: Actor, semesterId: string) {
  await assertCan(actor, "calendar.manageSemester");

  const current = await db.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!current) throw new ValidationError("Semester not found.");

  const state = current.state as SemesterState;
  if (!isDeletable(state)) {
    throw new StateError(
      `Only a Draft semester can be deleted. This one is ${SEMESTER_STATE_LABEL[state]}, and its records are permanent history.`,
    );
  }

  // Belt and braces against the state machine: a Draft should have no
  // offerings, but an offering created before this rule existed would make
  // the delete fail on a foreign key with an unreadable Postgres error
  // instead of a sentence explaining what to do.
  const offering = await db.query.courseOffering.findFirst({ where: eq(courseOffering.semesterId, semesterId) });
  if (offering) {
    throw new StateError("This semester still has course offerings. Remove them before deleting it.");
  }

  return asUser(actor.userId, async (tx) => {
    // Audit BEFORE the delete: the row's own values are what the log needs
    // to record, and after the DELETE there is nothing left to read them
    // from. Same transaction, so a failed delete rolls the entry back too.
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "SEMESTER_DELETED",
      entityType: "semester",
      entityId: semesterId,
      oldValue: {
        academicYearId: current.academicYearId,
        sequence: current.sequence,
        name: current.name,
        state: current.state,
        startDate: current.startDate,
        endDate: current.endDate,
      },
    });
    await tx.delete(semester).where(eq(semester.id, semesterId));
  });
}

/**
 * Guards checked before a transition is allowed (Section 13.2).
 *
 * Section 13.6 (DEC-34) kept at most one semester in the registration
 * window and at most one in grade submission. Those windows are now the
 * Open and In Progress states, so the same rule lands on them -- a College
 * runs one planning window and one live term at a time. Note this is a
 * guard on the TRANSITION, not a database constraint: the four-state
 * migration can legitimately leave two semesters Open (see
 * 0024_semester_four_states.sql), and those rows are not forced through a
 * state change they never asked for.
 */
async function assertGuardConditions(current: typeof semester.$inferSelect, toState: SemesterState): Promise<void> {
  if (toState === "OPEN" || toState === "IN_PROGRESS") {
    const conflicting = await db.query.semester.findFirst({
      where: and(eq(semester.state, toState), ne(semester.id, current.id)),
    });
    if (conflicting) {
      throw new StateError(
        `Another semester is already ${SEMESTER_STATE_LABEL[toState]}. ` +
          `Only one semester may be in this state at a time (Section 13.6).`,
      );
    }
  }

  // TODO (Stage 8): DRAFT -> OPEN should also require at least one
  // published offering to exist.
  // TODO (Stage 9): OPEN -> IN_PROGRESS should warn (not block) if plans
  // remain unapproved.
  // TODO (Stage 10): IN_PROGRESS -> CLOSED must block while any grade
  // submission is SUBMITTED/PARTIALLY_DECIDED or any correction is
  // PENDING, and warn if any registration has no published grade.
}
