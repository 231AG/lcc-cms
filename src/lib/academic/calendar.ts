import { and, eq, ne } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { academicYear, semester } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError, ForbiddenError, StateError } from "@/lib/errors";
import { findTransitionRule, legalNextStates, type SemesterState } from "./semesterStateMachine";

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

export async function transitionSemester(actor: Actor, input: TransitionSemesterInput) {
  await assertCan(actor, "calendar.transitionSemester");

  const current = await db.query.semester.findFirst({ where: eq(semester.id, input.semesterId) });
  if (!current) throw new ValidationError("Semester not found.");

  const fromState = current.state as SemesterState;
  const rule = findTransitionRule(fromState, input.toState);

  if (!rule) {
    const legal = legalNextStates(fromState).map((r) => r.to);
    throw new StateError(
      legal.length > 0
        ? `Cannot move from ${fromState} to ${input.toState}. Legal next state(s): ${legal.join(", ")}.`
        : `Cannot move from ${fromState} to ${input.toState}. ${fromState} is a terminal state for forward progress.`,
    );
  }

  if (actor.role !== rule.actorRole) {
    throw new ForbiddenError(
      `Moving a semester from ${fromState} to ${input.toState} requires the ${rule.actorRole} role.`,
    );
  }

  if (rule.reasonRequired && !input.reason?.trim()) {
    throw new ValidationError("A reason is required for this transition.");
  }

  await assertGuardConditions(current, rule.to);

  // REQ-A05 / Section 10.5: RLS only grants UPDATE on `semester` to the
  // ADMIN role. A Super Admin's backward/reopen transition is therefore
  // performed through the superuser connection, not asUser() -- this is
  // the "explicitly elevated, audited path" the plan calls for, not a
  // bypass of authorization (assertCan-equivalent role/rule checks above
  // already gated this before a single row was touched).
  const runAs: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> = rule.actorRole === "ADMIN"
    ? (fn) => asUser(actor.userId, fn)
    : (fn) => db.transaction(fn);

  return runAs(async (tx) => {
    const [row] = await tx
      .update(semester)
      .set({ state: input.toState })
      .where(eq(semester.id, input.semesterId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "SEMESTER_STATE_CHANGED",
      entityType: "semester",
      entityId: input.semesterId,
      oldValue: { state: fromState },
      newValue: { state: input.toState },
      reason: input.reason ?? null,
    });

    return row;
  });
}

/**
 * Guards checked before a transition is allowed (Section 13.2). Several of
 * the plan's stated guards reference tables that don't exist until later
 * stages (offerings/plans in Stage 8-9, grade submissions in Stage 10) --
 * those are marked TODO below and must be added when those stages land,
 * not silently skipped forever.
 */
async function assertGuardConditions(current: typeof semester.$inferSelect, toState: SemesterState): Promise<void> {
  if (toState === "OPEN" && current.state === "DRAFT") {
    // "Semester dates set and within the parent academic year" -- dates
    // are NOT NULL at the schema level and validated against the parent
    // year at creation time (createSemester), so nothing further to check.
  }

  // Section 13.6: at most one semester in Registration, and at most one
  // in Grade Submission, at any time (DEC-34, adopted).
  if (toState === "REGISTRATION" || toState === "GRADE_SUBMISSION") {
    const conflicting = await db.query.semester.findFirst({
      where: and(eq(semester.state, toState), ne(semester.id, current.id)),
    });
    if (conflicting) {
      throw new StateError(
        `Another semester is already in ${toState}. Only one semester may be in this state at a time (Section 13.6).`,
      );
    }
  }

  // TODO (Stage 8): OPEN -> REGISTRATION should also require at least one
  // published offering to exist.
  // TODO (Stage 9): REGISTRATION -> IN_PROGRESS should warn (not block) if
  // plans remain unapproved.
  // TODO (Stage 10): GRADE_SUBMISSION -> CLOSED must block while any
  // submission is SUBMITTED/PARTIALLY_DECIDED or any correction is
  // PENDING, and warn if any registration has no published grade.
  // TODO (Stage 9): OPEN <- REGISTRATION (Super Admin backward) should
  // require no plans exist.
  // TODO (Stage 10): IN_PROGRESS <- GRADE_SUBMISSION (Super Admin
  // backward) should require no grades submitted for approval.
  // TODO (Stage 10): GRADE_SUBMISSION <- CLOSED (Super Admin reopen)
  // should require no submission currently awaiting a decision -- though
  // by definition reopening starts a new decision window, so this guard
  // may turn out to be a no-op; revisit when Stage 10 exists.
}
