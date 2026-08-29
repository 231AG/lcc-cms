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
| DEC-14 | Add/drop workflow after plan approval — confirm design suits office | UAT (Stage 9/11) | **Confirmed by project owner, 2026-08-29** — current design (Admin-performed, audited add/drop after approval) is acceptable. |
| DEC-26 | Who adjudicates a conflicting/unreadable historical paper record | Before first real conflict (days after Stage 6 go-live use begins) | Registrar's office |
| DEC-29 | Synthetic internal identity (non-deliverable auth identifier) | **Acknowledged and approved** — proceeding with `<studentId>@students.<domain>.invalid` resolution | Approved by project owner |
| DEC-30 | Hosting/data-residency region for Supabase project | Before production data exists | **Chosen: West EU (London/Ireland region)** — recorded 25 Aug 2026 |
| DEC-31 | Production database tier (must include point-in-time recovery; no free tier in prod) | Before go-live (Stage 11) | **Still open — deliberately not addressed in Stage 11.** Project owner has decided to launch on the existing free-tier project with no backup/PITR for now (see DECISIONS.md DEV-09); upgrade deferred to a later phase. |

## Open — pre-coding administrative (Section 38.1)

| ID | Item | Status |
|---|---|---|
| — | This document (v2.1) countersigned as the Phase 1 engineering baseline | Pending — plan treats this as a project-owner/VPAA formality; proceeding on the project owner's instruction to build |
| — | Confirmation that Admin and Super Admin roles will be held by different people | **Confirmed by project owner, 2026-08-29** — different people will hold these roles, backing the real-world value of the segregation-of-duties design (ASM-13 closed accordingly). |

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

### DEV-05 — Historical record correction is direct Admin-only for Stage 6, no two-key approval yet (narrows plan Section 11.3's recommendation)

**Date:** Stage 6, at kickoff.
**Decision:** Plan Section 11.3 recommends that correcting an already-entered historical record follow the
same two-key path as a locked grade correction (Admin proposes, Super Admin approves) once a student's
import status is Complete -- but this is stated as a RECOMMENDATION, not a hard requirement. The owner chose
the simpler path for Stage 6: an Admin corrects a historical record directly, fully audited (actor, old
value, new value, mandatory reason via `HISTORICAL_RECORD_CORRECTED`), no second-approver step. Super Admin
remains refused from entering or correcting historical records either way (REQ-R04-style exclusion, matches
every other academic-write boundary in this system).
**Rationale given:** Avoids building a full two-person approval workflow twice (once here, once for real
grade corrections in Stage 10) before there's operational experience with how often historical corrections
actually happen.
**Consequence:** If corrections turn out to need tighter control once real paper-record entry is underway,
this can be upgraded to the two-key path later -- the audit trail already captures everything a future
approval step would need (actor, old/new values, reason), so upgrading doesn't require redesigning the data
model, just adding a gate in front of the existing write.
**Approval status:** Confirmed by project owner, 2026-08-27.

### DEV-06 — DEC-26 (conflict adjudication) scoped down for Stage 6: capture and flag, no adjudicator role enforced in software

**Date:** Stage 6, at kickoff.
**Decision:** DEC-26 (who adjudicates a conflicting/unreadable historical paper record) remains open in the
operational sense -- the College hasn't named a role or person yet. The owner confirmed Stage 6 should build
to REQ-H07's actual minimum bar without waiting on that answer: the system holds one authoritative
`academic_record` row, captures the conflict in `source_note` and the audit log, and keeps the student's
import status at IN_PROGRESS (never auto-advances to COMPLETE while an unresolved conflict exists). No
specific role is enforced in code as "the adjudicator" -- any Admin may resolve a flagged conflict through
the normal historical-correction path (DEV-05), the same way any Admin can correct any other historical
record.
**Rationale given:** The technical behavior (hold, flag, don't auto-resolve) doesn't actually depend on
knowing which named person does the resolving -- that's an Admin-office staffing question, not a data model
question.
**Consequence:** DEC-26 stays open in DECISIONS.md's operational table; if the College later wants adjudication
restricted to a specific person or sub-role, that would need a new permission action distinct from ordinary
`identity.correctHistoricalRecord`-type Admin access, added when that requirement is real.
**Approval status:** Confirmed by project owner, 2026-08-27 -- DEC-26 itself remains open pending the
Registrar's office naming a role, tracked separately above.

### DEV-07 — Prerequisite override is allowed on a DRAFT or REJECTED plan item, not only a SUBMITTED one (resolves an ordering gap in Section 14.5)

**Date:** Stage 9, during implementation.
**Decision:** Section 14.4 makes V1 (prerequisites) a BLOCKING check at submission itself, not only at
approval -- yet Section 14.5's override is described only via A-11 ("Course plan review"), whose queue
shows SUBMITTED plans exclusively (Section 14.2: a DRAFT plan is "invisible in the Admin approval
queue"). Read literally, a student whose prerequisite genuinely cannot be verified -- explicitly called
out as the overwhelmingly common case in year one, Section 17.8 -- could never reach SUBMITTED at all,
so the override could never be reached either: a real ordering gap, not a design choice stated in the
plan. `overridePrerequisite` in `src/lib/planning/planning.ts` resolves it by allowing the override on
any non-terminal plan item (DRAFT, SUBMITTED, or REJECTED, refused only once APPROVED), so an Admin can
apply it before the student's first submission attempt as well as during review.
**Rationale given:** This is the only reading under which REQ-P11 (the override) and REQ-P03/Section
14.4 (V1 blocking at submission) can both be true at once -- the alternative would have V1 make the
override provision unreachable for exactly the population it exists to serve.
**Consequence:** A-11 ("Course plan review") includes a "look up a specific plan" path in addition to
the SUBMITTED-only queue, so an Admin can reach a DRAFT plan to apply an override before the student
submits, not only plans already awaiting a decision.
**Approval status:** Not a deviation requiring approval -- resolves an internal ordering gap using the
plan's own stated rules (V1 blocking scope, override purpose) rather than introducing new policy.
Recorded so the override's reachable scope doesn't get mistaken for an oversight in a future audit.

### DEV-08 — Stage 11 continues the branch-per-stage chain; no merge to `main` yet

**Date:** Stage 11, at kickoff.
**Decision:** Stages 1-10 exist as unmerged `stage/NN-*` branches; `main` is still the original placeholder
README. The owner chose to keep chaining `stage/11-hardening-go-live` on top of `stage/10-grade-management`
rather than merging the completed stages into `main` first.
**Consequence:** `main` will not reflect real progress until an explicit integration step happens. That step
still has to occur before or at go-live -- deploying to production means deploying *some* branch's content,
and the plan's own environment model (Section 8.5) assumes `main` is what ships. Tracked here so the
eventual "merge everything to `main`" step isn't skipped by mistake.
**Approval status:** Confirmed by project owner, 2026-08-29.

### DEV-09 — No backup/PITR for now; production runs on the existing free-tier Supabase project (deviates from DEC-31 and narrows Stage 11's Gate G11)

**Date:** Stage 11, at kickoff.
**Decision:** The plan's Stage 11 acceptance criteria require "a restore from backup has been performed and
verified" as a hard gate condition for G11 (Go-Live Gate), and DEC-31 requires a paid tier with point-in-time
recovery before go-live -- explicitly *not* satisfied by a free tier. The owner has decided, for now, to run
production on the same single free-tier Supabase project already used for development (continuing DEV-01),
with **no backup configuration and no restore rehearsal** in this pass. The Supabase subscription will be
upgraded "once we are done with the different phases."
**Rationale given:** Defers infrastructure cost/setup until later phases are further along.
**Consequence -- read carefully, this is a real operational risk, not a paperwork gap:** Until this is
revisited, **there is no recovery path from data loss, corruption, or accidental deletion of any student
record, grade, or GPA in production.** A dropped table, a bad migration, a compromised credential, or a
Supabase incident is unrecoverable. This also means Stage 11's own acceptance criteria for G11 (Go-Live Gate)
**cannot be fully met** under the plan's own definition -- what ships is a soft-launch/pilot on unprotected
infrastructure, not the plan's "Go-Live" as specified. DEC-31 stays open. The semester-export feature and the
reconciliation-query runner (Stage 11's other DB-hardening deliverables) are unaffected and will still be
built -- only backup/restore is deferred.
**Approval status:** Confirmed by project owner, 2026-08-29 -- explicitly accepted the risk above.

### DEV-10 — Security review performed as an internal code-level audit, not a third-party review

**Date:** Stage 11, at kickoff.
**Decision:** The plan's Stage 11 scope calls for a "full review against Section 18" and "dependency
vulnerability sweep." The owner confirmed this will be done as a self-review of the codebase against every
§18 control (rather than an external consultant or penetration test), matching the plan's own guidance that a
formal penetration test is a FUTURE/Phase-2 item, not a Phase 1 requirement.
**Consequence:** Findings and fixes will be recorded directly against the code; there is no independent
third-party sign-off backing the security review for this go-live.
**Approval status:** Confirmed by project owner, 2026-08-29.

### DEV-11 — Administrator manual and student guide delivered as Markdown in the repo

**Date:** Stage 11, at kickoff.
**Decision:** Stage 11's documentation deliverables (administrator manual, student guide) will be written as
plain Markdown files in the repository, alongside `DECISIONS.md`/`ASSUMPTIONS.md`, rather than as separate
formatted documents (Word/PDF).
**Consequence:** These documents version with the code and are easy to keep in sync as features change, but
are not immediately in a format ready to hand to non-technical Admin office staff without conversion.
**Approval status:** Confirmed by project owner, 2026-08-29.

### DEV-12 — CI cannot run ~45% of the integration suite without real Supabase Auth; accepted as a known gap rather than provisioning a second project

**Date:** Stage 11, during CI work.
**Decision:** Running the full test suite fresh (migrate → seed → test, exactly as `ci.yml` does) for the
first time ever in this session surfaced two things. First, **this repository's GitHub Actions workflow has
never actually run — zero workflow runs recorded** — because it only triggers on push-to-`main` or a pull
request, and neither has happened yet; every stage's "tests pass" claim to date was verified locally, not by
CI. Second, once run fresh, 9 of 20 test files fail: `realSuperAdminActor()` (the pattern every integration
test since Stage 3 uses to get an `Actor` for FK-bound writes) found no bootstrapped Super Admin, because
nothing bootstraps one from scratch — fixed here with a new test-only fixture script
(`src/lib/db/testFixtures.ts`, `npm run test:fixtures`, wired into `ci.yml`). But underneath that, every one
of those same 9 files also calls `createStaffAccount`/`enrollStudent` at some point, which calls
`createAdminClient()` — a real Supabase Admin API call. `ci.yml` has no Supabase credentials at all (by
design: DEV-01/DEV-09 keep one shared project, and CI was never going to write test accounts into it). The
owner was offered a free-tier Supabase project dedicated solely to CI/test use (zero cost, doesn't touch the
production-designated project) and **declined it, choosing to accept the gap for now.**
**Consequence:** CI (once it actually runs) will pass lint/typecheck/build and the ~11 test files that don't
create a Supabase-backed account (pure unit tests: GPA engine, semester state machine, Student-ID resolution,
plus a handful of RLS/privilege integration tests). The other 9 files — covering academic structure, calendar,
GPA recomputation, grades, historical import, offerings, planning, students, and account management — **do
not run in CI and must continue to be run locally against a real Supabase project by whoever is developing
that area**, until a test Supabase project is provisioned. This means Stage 11's G11 acceptance criterion
"the full regression suite passes with nothing skipped" **is not literally achievable** under the current
setup — `ci.yml` will be annotated to say exactly which files are excluded and why, rather than silently
passing a smaller suite.
**Approval status:** Confirmed by project owner, 2026-08-29 -- explicitly declined the free test-project
option and accepted this gap.

### DEV-13 — `next build` fails on every authenticated page without any Supabase env vars present; fixed with placeholder public values in CI

**Date:** Stage 11, during CI work.
**Finding:** Continuing DEV-12's investigation, `npm run build` was also run for the first time against
`ci.yml`'s exact environment (only `DATABASE_URL` set, no Supabase vars at all) and failed: `next build`'s
static-generation pass calls each page once to decide static vs. dynamic, and `src/lib/supabase/server.ts`
throws its own "must be set" error the moment any admin/auth page is probed, before the code ever reaches the
`cookies()` read that would normally tell Next.js to mark the route dynamic and skip prerendering it. This is
not a Cache Components issue (not enabled in `next.config.ts`) -- it is that the explicit env-var guard fires
first. Confirmed the fix: setting `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` to any
non-empty placeholder value (they never need to resolve to a real project -- `cookies()` short-circuits the
prerender attempt before any network call happens) lets the build correctly mark all 21 routes dynamic (`ƒ`)
and complete. `ci.yml` now sets these two as harmless placeholders (they are public, non-secret values by
design; nothing sensitive is exposed by hardcoding a fake one in the workflow file).
**Consequence:** Like DEV-12, this had never been caught because CI has never actually run. No code change
was needed -- only `ci.yml`'s env block.
**Approval status:** Not a deviation requiring approval -- a CI configuration fix for a real, previously
undetected build failure, not a design change.

### DEV-14 — DER-25's 150KB student-page JS budget is measurably exceeded by the framework baseline alone; flagged, not silently waived

**Date:** Stage 11, performance verification.
**Finding:** Measured `/login` (zero client components -- a plain server-rendered form with a server action,
nothing this codebase could trim further at the component level) against a real production build: **~174KB
of JavaScript gzipped** (~566KB uncompressed) is sent to the browser, against DER-25's stated budget of
"student-facing pages ≤ 150KB of JavaScript transferred." Confirmed by grepping the shipped chunks that none
of it is server-only code leaking into the client bundle (no `supabase`/`postgres`/`drizzle`/service-role
strings found) -- this is React 19 + Next.js 16 App Router's own client runtime (hydration, RSC protocol,
client-side router), not application code. The budget appears to have been written without accounting for
this framework floor.
**Consequence:** This is a real, measured gap against a literal Stage 11 acceptance number, not a
judgement call to wave through. Closing it for real would mean a materially different rendering approach for
at least the fully-anonymous pages (e.g., a true static-HTML login page with no Next.js client runtime at
all) -- larger than a Stage 11-sized change to attempt unprompted. Recorded here rather than either quietly
passing or quietly fixing; needs a decision on whether to accept the number as measured, revise DER-25, or
scope a follow-up change.
**Approval status:** Open -- awaiting project owner decision.
