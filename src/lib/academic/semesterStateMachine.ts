import type { Role } from "@/lib/permissions/kernel";

/**
 * The six-state semester lifecycle (REQ-W01, plan Section 13). Pure data
 * and pure functions -- no database access -- so the whole legal-transition
 * table can be exhaustively unit tested (plan principle P3).
 */
export const SEMESTER_STATES = [
  "DRAFT",
  "OPEN",
  "REGISTRATION",
  "IN_PROGRESS",
  "GRADE_SUBMISSION",
  "CLOSED",
] as const;

export type SemesterState = (typeof SEMESTER_STATES)[number];

export interface TransitionRule {
  from: SemesterState;
  to: SemesterState;
  /** Which role may perform this specific transition -- not a hierarchy;
   *  Super Admin cannot do the Admin-only forward moves and vice versa
   *  (Section 11.3: "Advance forward" is Admin-only, "Move backwards" is
   *  Super-Admin-only). */
  actorRole: Extract<Role, "ADMIN" | "SUPER_ADMIN">;
  reasonRequired: boolean;
}

/**
 * Section 13.2's transition table, verbatim. Every pair not listed here is
 * illegal. There is no "force" path anywhere in this codebase.
 */
export const LEGAL_TRANSITIONS: readonly TransitionRule[] = [
  { from: "DRAFT", to: "OPEN", actorRole: "ADMIN", reasonRequired: false },
  { from: "OPEN", to: "REGISTRATION", actorRole: "ADMIN", reasonRequired: false },
  { from: "REGISTRATION", to: "IN_PROGRESS", actorRole: "ADMIN", reasonRequired: false },
  { from: "IN_PROGRESS", to: "GRADE_SUBMISSION", actorRole: "ADMIN", reasonRequired: false },
  { from: "GRADE_SUBMISSION", to: "CLOSED", actorRole: "ADMIN", reasonRequired: false },

  { from: "OPEN", to: "DRAFT", actorRole: "SUPER_ADMIN", reasonRequired: true },
  { from: "REGISTRATION", to: "OPEN", actorRole: "SUPER_ADMIN", reasonRequired: true },
  { from: "IN_PROGRESS", to: "REGISTRATION", actorRole: "SUPER_ADMIN", reasonRequired: true },
  { from: "GRADE_SUBMISSION", to: "IN_PROGRESS", actorRole: "SUPER_ADMIN", reasonRequired: true },
  { from: "CLOSED", to: "GRADE_SUBMISSION", actorRole: "SUPER_ADMIN", reasonRequired: true },
] as const;

export function findTransitionRule(from: SemesterState, to: SemesterState): TransitionRule | undefined {
  return LEGAL_TRANSITIONS.find((r) => r.from === from && r.to === to);
}

export function legalNextStates(from: SemesterState): TransitionRule[] {
  return LEGAL_TRANSITIONS.filter((r) => r.from === from);
}

/** Capability-by-state table (Section 13, Figure 13.1) -- used by later
 * stages to gate their own operations; defined now so the vocabulary is
 * settled once, in one place. */
export function isStudentVisible(state: SemesterState): boolean {
  return state !== "DRAFT";
}
