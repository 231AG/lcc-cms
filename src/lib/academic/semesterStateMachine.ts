import type { Role } from "@/lib/permissions/kernel";

/**
 * The four-state semester lifecycle. Pure data and pure functions -- no
 * database access -- so the whole legal-transition table can be
 * exhaustively unit tested (plan principle P3).
 *
 * This replaces the six-state model of REQ-W01 (DRAFT / OPEN / REGISTRATION
 * / IN_PROGRESS / GRADE_SUBMISSION / CLOSED). REGISTRATION folded into
 * OPEN and GRADE_SUBMISSION folded into IN_PROGRESS -- the two pairs were
 * never separable in practice, because everything the extra state gated was
 * the only thing that state was for. See drizzle/0024_semester_four_states.sql
 * for the data migration and the old -> new mapping.
 *
 *   Draft       -- setup only. Nothing is visible to students. The only
 *                  state a semester can be deleted from.
 *   Open        -- published. Students browse the catalogue and build,
 *                  edit and submit course plans; Admins review them, and
 *                  approval creates registrations.
 *   In Progress -- the term is running. Plans and registrations are
 *                  read-only to students; Admins do audited late adds and
 *                  drops and enter draft grades. Grade submission and
 *                  approval is its own workflow on top of this state.
 *   Closed      -- final and read-only. Records are sealed as permanent
 *                  history.
 *
 * Movement is forward-only. The single exception is the Closed -> In
 * Progress reopen, which is Super Admin-only and always needs a reason.
 */
export const SEMESTER_STATES = ["DRAFT", "OPEN", "IN_PROGRESS", "CLOSED"] as const;

export type SemesterState = (typeof SEMESTER_STATES)[number];

/** The roles that may ever move a semester. Students never appear here. */
export type StaffRole = Extract<Role, "ADMIN" | "SUPER_ADMIN">;

/** Human-facing name for a state. The stored value stays SCREAMING_SNAKE. */
export const SEMESTER_STATE_LABEL: Record<SemesterState, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};

/** One line of what a state means, shown beside the state picker. */
export const SEMESTER_STATE_DESCRIPTION: Record<SemesterState, string> = {
  DRAFT: "Setup only. Nothing is visible to students, and this is the only state a semester can be deleted from.",
  OPEN: "Published to students. They browse offerings and submit course plans; approving a plan creates registrations.",
  IN_PROGRESS: "The term is running. Students can view but not edit; Admins make audited late changes and enter draft grades.",
  CLOSED: "Final and read-only. Records are sealed; reopening needs a Super Admin and a reason.",
};

export interface TransitionRule {
  from: SemesterState;
  to: SemesterState;
  /** Who may perform this specific transition. Unlike the six-state model,
   *  the ordinary forward moves are open to BOTH staff roles -- changing a
   *  semester's state is separate from creating one, which stays Admin-only
   *  (`calendar.manageSemester`). */
  actorRoles: readonly StaffRole[];
  /** True when the transition needs a reason from anyone, whatever their
   *  role -- the reopen, and only the reopen. Everywhere else the reason is
   *  required of an Admin and optional for a Super Admin; see
   *  `reasonRequiredFor`. */
  reasonAlwaysRequired: boolean;
  /** A move backwards through the lifecycle. Only the reopen is one. */
  isReopen: boolean;
}

const BOTH: readonly StaffRole[] = ["ADMIN", "SUPER_ADMIN"];
const SUPER_ADMIN_ONLY: readonly StaffRole[] = ["SUPER_ADMIN"];

/**
 * The complete transition table. Every pair not listed here is illegal --
 * there is no "force" path anywhere in this codebase.
 */
export const LEGAL_TRANSITIONS: readonly TransitionRule[] = [
  { from: "DRAFT", to: "OPEN", actorRoles: BOTH, reasonAlwaysRequired: false, isReopen: false },
  { from: "OPEN", to: "IN_PROGRESS", actorRoles: BOTH, reasonAlwaysRequired: false, isReopen: false },
  { from: "IN_PROGRESS", to: "CLOSED", actorRoles: BOTH, reasonAlwaysRequired: false, isReopen: false },

  // The one way back. A Super Admin, a mandatory reason, and an audit
  // record written in the same transaction as the state change -- so the
  // record exists before anything else can be modified.
  { from: "CLOSED", to: "IN_PROGRESS", actorRoles: SUPER_ADMIN_ONLY, reasonAlwaysRequired: true, isReopen: true },
] as const;

export function findTransitionRule(from: SemesterState, to: SemesterState): TransitionRule | undefined {
  return LEGAL_TRANSITIONS.find((r) => r.from === from && r.to === to);
}

/** Every state this one may move to, regardless of who is asking. */
export function legalNextStates(from: SemesterState): TransitionRule[] {
  return LEGAL_TRANSITIONS.filter((r) => r.from === from);
}

/** Every state THIS actor may move the semester to. */
export function legalNextStatesForRole(from: SemesterState, role: Role): TransitionRule[] {
  return legalNextStates(from).filter((r) => (r.actorRoles as readonly Role[]).includes(role));
}

/**
 * Whether a reason must accompany this transition.
 *
 * An Admin always gives one -- they are the role making routine forward
 * moves, and "why did this term close two weeks early" is a question worth
 * being able to answer. A Super Admin's is optional, except on the reopen,
 * where it is the whole point of the audit record.
 */
export function reasonRequiredFor(rule: TransitionRule, role: Role): boolean {
  return rule.reasonAlwaysRequired || role === "ADMIN";
}

// ---------------------------------------------------------------------------
// Capability-by-state
// ---------------------------------------------------------------------------
// One vocabulary for "what may happen in this state", so a service never
// compares a state string itself. Every caller that used to test for
// REGISTRATION or GRADE_SUBMISSION now asks one of these questions instead.

/** Anything at all about this semester is visible to students. */
export function isStudentVisible(state: SemesterState): boolean {
  return state !== "DRAFT";
}

/** Students may create, edit and submit course plans; Admins may approve
 *  them into registrations. (Was: state === "REGISTRATION".) */
export function isPlanningOpen(state: SemesterState): boolean {
  return state === "OPEN";
}

/** Admins may enter and edit draft grades, and submit them for approval.
 *  (Was: state === "GRADE_SUBMISSION".) */
export function isGradeEntryOpen(state: SemesterState): boolean {
  return state === "IN_PROGRESS";
}

/** Offerings, sections and meeting times may still be edited. Once the term
 *  is running, changes go through the audited late add/drop path instead. */
export function isOfferingEditable(state: SemesterState): boolean {
  return state === "DRAFT" || state === "OPEN";
}

/** The semester is sealed: reports and printing only, no modification. */
export function isSealed(state: SemesterState): boolean {
  return state === "CLOSED";
}

/** A semester may be deleted only before it has ever been published. */
export function isDeletable(state: SemesterState): boolean {
  return state === "DRAFT";
}

/** The two states that are "live" for work-queue purposes: a published
 *  semester students can plan in, and one whose term is running. */
export const ACTIVE_SEMESTER_STATES = ["OPEN", "IN_PROGRESS"] as const satisfies readonly SemesterState[];
