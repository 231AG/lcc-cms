# Decision Register — LCC E-Portal Phase 1

Seeded from `LCC_EPortal_Phase1_Development_Plan_v2.1.pdf`, Section 34 (25 Aug 2026). All entries below are carried
forward as-is from the planning document. This file is updated at every stage gate per the operating protocol
(Master Instruction, Section 22).

Format: `ID | Decision | Status | Stage | Note`

## Closed — academic policy (no action needed)
All nine blocking decisions (DEC-01 through DEC-09 lineage, see plan §34) and all academic-policy items are
**closed**. See the plan document itself for the full table; nothing here is re-litigated.

## Open — operational / configuration (non-blocking for coding, needed before the relevant stage/gate)

| ID | Decision | Needed before | Owner |
|---|---|---|---|
| DEC-12 | Prerequisite override window and expiry date | Stage 9 (recommend: end of first live semester) | College / Super Admin |
| DEC-14 | Add/drop workflow after plan approval — confirm design suits office | UAT (Stage 9/11) | Admin office |
| DEC-26 | Who adjudicates a conflicting/unreadable historical paper record | Before first real conflict (days after Stage 6 go-live use begins) | Registrar's office |
| DEC-29 | Synthetic internal identity (non-deliverable auth identifier) | **Acknowledged and approved** — proceeding with `<studentId>@students.<domain>.invalid` resolution | Approved by project owner |
| DEC-30 | Hosting/data-residency region for Supabase project | Before production data exists | **Chosen: West EU (London/Ireland region)** — recorded 25 Aug 2026 |
| DEC-31 | Production database tier (must include point-in-time recovery; no free tier in prod) | Before go-live (Stage 11) | Current project is **free tier**, used as the development environment. Production must move to a paid tier with daily backup + PITR before go-live — not yet provisioned. |

## Open — pre-coding administrative (Section 38.1)

| ID | Item | Status |
|---|---|---|
| — | This document (v2.1) countersigned as the Phase 1 engineering baseline | Pending — plan treats this as a project-owner/VPAA formality; proceeding on the project owner's instruction to build |
| — | Confirmation that Admin and Super Admin roles will be held by different people | Pending — operational/policy, not blocking code |

## Assumptions to confirm before specific stages (see ASSUMPTIONS.md for full list)

| ID | Assumption | Confirm before |
|---|---|---|
| ASM-20 | "Major course" = course owned by the student's own department | Stage 7 (GPA engine) |
| ASM-21 | "Two inactive semesters" = two consecutive semesters with no approved registration | Stage 5 (Students) |
| ASM-19 | "Most recent attempt" counts in CGPA even if worse than an earlier attempt (carried from source doc) | Stage 7 (Registrar to glance at fixture F-13) |

### DEV-02 — Department deactivation does not yet check for active students (Stage 3, deferred to Stage 5)

**Decision:** `setDepartmentActive(false)` currently blocks only on active *courses* in the department. The
plan's own Section 9.4.3 constraint ("a department cannot be deactivated while it has ACTIVE students")
can't be implemented yet because the `student` table doesn't exist until Stage 5.
**Consequence:** When Stage 5 adds the student table, `setDepartmentActive` must be extended to also
check for active students before allowing deactivation, with the same "name the blockers" error style
already used for courses.
**Approval status:** Not a deviation requiring approval — this is the plan's own stage-dependency
ordering (Stage 3 before Stage 5) surfacing directly in the code. Recorded so it isn't forgotten.

## Engineering decisions made during implementation

(New entries added here as Stage 1+ work proceeds, per format: ID | Date | Stage | Decision | Alternatives | Rationale | Approval status)

### DEV-01 — Single Supabase project used for development, staging, and production (deviates from plan Section 8.5)

**Date:** Stage 1, during initial build.
**Decision:** The plan's hard rule is three separate Supabase projects (dev/staging/prod), never
shared, because "a copied student record in a test environment is a data breach waiting for a
misconfiguration" (Section 8.5). The project owner has explicitly approved using the **one** existing
free-tier Supabase project for all three purposes for now, and will separate them before real
institutional data or real end-user testing begins.
**Rationale given:** No live/production data exists yet; live testing will happen once production is
otherwise ready, at which point proper separation will be introduced.
**Consequence / what must still happen before go-live:** Before Stage 11 (or before any real student
data enters the system, whichever comes first), this must be revisited: (1) split into separate dev/
staging/prod Supabase projects, (2) confirm the production tier has point-in-time recovery (DEC-31,
still open), (3) never let synthetic/test data and real academic records coexist in the same project.
Local development in the meantime continues to default to Docker Postgres (`docker-compose.yml`)
unless the team decides to point `DATABASE_URL` at the shared Supabase project directly.
**Approval status:** Approved by project owner.

### DEV-03 — Super Admin's backward semester transition runs through the superuser DB connection, not `asUser()` (Stage 4)

**Date:** Stage 4.
**Decision:** RLS on `app.semester` (migration `0007_calendar_constraints_rls.sql`) only grants UPDATE
to the ADMIN role. Postgres row-level security cannot express "Super Admin may update this row, but
only for these specific from/to state pairs" -- that check belongs in the pure transition table
(`semesterStateMachine.ts`), not in a policy. `transitionSemester` in `src/lib/academic/calendar.ts`
therefore branches: an Admin's forward move runs through `asUser()` as before (RLS genuinely applies);
a Super Admin's backward/reopen move runs through `db.transaction()` directly (the superuser
connection), after `assertCan()` and the transition-rule role/reason checks have already gated it.
**Rationale given:** This is Section 10.5's own documented exception ("except the semester-state
backward transition, which the service performs under an explicitly elevated, audited path"), not an
RLS bypass discovered by accident -- role and transition-legality checks happen in the service layer
before a single row is touched, and the transition is still written to `audit_log` with old/new state
and the mandatory reason in the same transaction.
**Consequence:** Any future write path that needs "this role, but only under these conditions" should
follow the same pattern (service-layer gate + superuser write + audit) rather than trying to encode
conditional logic into an RLS policy.
**Approval status:** Not a deviation requiring approval -- implements the plan's own stated exception.
Recorded so the RLS-bypass path doesn't get mistaken for an oversight in a future audit.

### DEV-04 — Admission forfeiture (CR-09) scoped to newly-enrolled students who never register (narrows plan Section 12.6)

**Date:** Stage 5, at kickoff.
**Decision:** Plan Section 12.6 defines the forfeiture trigger as "no approved registration in either of the
two most recently closed semesters, and their status is Active" -- read literally, this covers *any* Active
student who later stops registering, not just a brand-new admit. The project owner clarified the intent is
narrower: a student who is granted admission and never attends even one semester -- if they have no approved
registration in the two consecutive semesters immediately after their account is created, the admission is
the thing that's forfeited (not an in-progress academic career). Reactivation after due process stays
**Admin-only** -- the owner confirmed Super Admin should not gain student-edit power, keeping REQ-R04's
existing RBAC split (Super Admin: read students, never write) unchanged.
**Rationale given:** Matches how the College actually thinks about the status -- "forfeiting an admission"
describes someone who never showed up, not someone withdrawing partway through their studies (the latter is
what the Inactive/Suspended statuses already cover per DEC-16).
**Consequence:** When the forfeiture candidate report (A-21) is actually built, its query must be scoped to
students whose *first two* semesters after enrolment (not *any* two consecutive closed semesters) had no
approved registration -- this is a real logic difference from a literal reading of Section 12.6, not just a
UI label. The report itself still cannot be built until the `registration` table exists (Stage 8+); Stage 5
only needs to accommodate the `ADMISSION_FORFEITED` status value and Admin-only status-change/reactivation,
not the report logic itself.
**Approval status:** Confirmed by project owner, 2026-08-26.
