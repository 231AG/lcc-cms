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

**Resolved 1 Sep 2026:** merged to `main` after all, driven by a real constraint rather than a design
change — the project owner's Vercel plan does not allow selecting a non-default Production Branch, so
deploying at all required `main` to hold the real code. `origin/main`'s tip was a direct ancestor of
`stage/11-hardening-go-live` (nothing had ever been pushed to `main` independently), so this was a clean
`git merge --ff-only` — no conflicts, no rewritten history, no divergent branches to reconcile. `main` and
`stage/11-hardening-go-live` are identical as of commit `62b9afc`.

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

**Addendum (later in Stage 11):** the same reasoning applies to Playwright e2e (`e2e/*.spec.ts`) --
every spec signs in through the real login form, so it needs a real Supabase project exactly like the 9
excluded vitest files. `npm run test:e2e` is not run in CI, annotated in `ci.yml` accordingly. A new spec was
added this stage (`e2e/admin-grades.spec.ts`, covering Stage 10's grade-submission/approval/publish lifecycle
end to end) and the existing `auth.spec.ts` was extended with two more must-change-password bypass checks
regression-testing the `src/proxy.ts` fix (see SECURITY_REVIEW.md) -- both were typechecked and confirmed to parse/list
correctly via `npx playwright test --list`, but **neither has actually been run against a real browser and
Supabase project**, for the same reason the 9 vitest files can't be. Flagged for the local execution
checklist, not claimed as verified.

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

**Follow-up measurement (same day):** the project owner asked for the actual real-world requirement to be
checked directly -- DER-25's other clause, "interactive within 3s on a 3G-class connection" -- rather than
treating the KB figure as the thing that matters. Measured with a throwaway script (`scripts/measure-
performance.mjs`, kept in-repo for reproducibility) driving Playwright/Chromium against the real production
build (`next start`) of `/login`, under Chrome DevTools' "Slow 3G" profile (400 Kbps down/up, 400ms RTT) plus
4x CPU throttling, averaged over 4 runs:

| Metric | Measured |
|---|---|
| `domInteractive` (DOM parsed, page usable -- login's form has no client component, so this is genuinely when a user can act) | **~1.44s** |
| Full `load` event (every JS chunk finished downloading, including framework code not required for this page's own interactivity) | **~5.1s** |

**Reading:** under the plan's literal 3G-class/3s clause, `/login` is usable in ~1.4s -- inside budget, by a
comfortable margin, because the page needs no client-side hydration to function (the form works via a server
action whether or not any JS has finished loading). The 5.1s figure is real but measures something DER-25
does not appear to be asking about for this page: full framework-runtime download, most of which this page
has no functional need for. **The system does not fail the stated real-world requirement (interactive <3s on
3G) for `/login`; it fails only the JS-transfer-size proxy for that requirement.** This could not be checked
for an authenticated student page (`/portal`, `/planning`) without a live session in this environment -- flagged
under "what requires local execution" below.
**Recommendation:** treat DER-25's byte-count clause as a good early proxy that has been overtaken by React
19/Next 16's baseline runtime size, not as evidence of a real problem in this specific case -- the thing the
byte budget exists to protect (a slow-feeling page on a bad connection) is not actually occurring, per direct
measurement. Suggest formally revising DER-25 to state the *outcome* (interactive within 3s on 3G-class) as
the acceptance criterion, with the KB figures kept as a secondary early-warning guideline rather than a hard
gate -- rather than either silently dropping the byte figure or blocking go-live on a proxy metric that the
direct measurement shows is not predicting a real problem here. Re-run this same measurement against `/portal`
and `/planning` once a real session is available (see local execution checklist) before finalizing, since
those are the pages actual students use most and were not reachable from this environment.
**Approval status:** Open -- awaiting project owner decision on the recommendation above. Left open on
purpose, per explicit instruction: do not silently change the requirement or degrade the application to
force the number under 150KB.

### DEV-15 — the full test suite (all 20 files) and the new I-05 reconciliation check both ran against real Supabase for the first time; one real cleanup-ordering bug found and fixed

**Date:** After Stage 11, once the project owner provided real Supabase credentials and access to run
locally.
**What happened:** `npm run test` (not `test:ci` -- the full suite, including the 9 files DEV-12 excludes
from CI) was run against a real Supabase project for the first time in this project's history. All 20 files,
237 tests, passed. `npm run db:reconcile` (also its first-ever run against real data) then reported 11 I-05
violations: published `grade_record` rows with no linked `academic_record`.
**Root cause:** `grades.integration.test.ts`'s `afterAll` deleted `gradeRecord` rows before deleting the
`academicRecord` rows that reference them via `grade_record_id` (`onDelete: "restrict"`) -- the delete was
refused by Postgres and silently swallowed by the cleanup's own `.catch(() => {})`, leaving the grade_record
behind once the (unconstrained) `academicRecord` delete succeeded afterward. Confirmed all 11 affected
students were "Test Student-*" fixtures (not real data) before removing them.
**Fix:** reordered the cleanup to delete `academicRecord` rows first (see the code comment at the top of
that `afterAll` block); re-ran `npm run db:reconcile` afterward -- zero mismatches. This was a test-cleanup
bug, not an application defect -- the actual `approveSubmission`/publish transaction in `grades.ts` is
unaffected and was never in question.
**Significance:** this is exactly what a reconciliation check run against real data before real use is for
-- see `docs/BACKUP_RESTORE_RUNBOOK.md`'s instruction to run it after every restore rehearsal, and the
plan's own "run before every go-live and at every semester end." First real run, first real (if minor)
finding, caught and fixed.

**Two more findings surfacing during the same investigation, same session:**
1. That same test file also used a fully hardcoded academic year label (`"2096/2097"`) with a
   reuse-on-conflict fallback on `createAcademicYear` but none on `createSemester` -- residue from an
   independent, unrelated earlier run on this machine (predating this session, 10 offerings and 2
   registrations deep) made a fresh isolated run of the file fail outright with "Sequence 1 already exists."
   Fixed by time-suffixing the label (`2100 + Date.now() % 90`), matching the convention already used in
   `admin-offerings.spec.ts`; the leftover residue itself was cleaned up directly (confirmed via query it was
   the test's own far-future fixture, zero academic_record rows, before deleting).
2. A `db:reconcile` run partway through this cleanup reported 16 more I-15 "mismatches" that turned out to
   be **correct, benign self-healing, not bugs**: several test-fixture students (created by other suites --
   offerings, planning -- that enroll students but never publish a grade for them) had never had a
   `student_cumulative_summary` row created at all. `reconcileSummariesMatchEngine` correctly detected the
   missing row, `recomputeStudentSummaries` correctly created it (with a legitimately null CGPA, since they
   have zero GPA-eligible records), and a subsequent run confirmed zero mismatches. No code change was
   needed here -- included in this record only because "reconciliation FAILED" reads alarming for what is
   actually the self-healing mechanism (documented in `reconciliation.ts`'s own comment) doing its job.
**Approval status:** Not a deviation requiring approval -- test-code bug fixes and one confirmed non-bug,
not a design change.

### DEV-16 — e2e/admin-grades.spec.ts (written but never run in the cloud session that authored it) needed five real fixes before it ran clean end to end

**Date:** Same session as DEV-15, continuing local verification once real Supabase access was available.
**Context:** This spec was written and typechecked, but explicitly flagged as NOT run-verified (no real
Supabase in that session). Running it for real, iteratively, surfaced:
1. `publishOffering` requires at least one meeting time -- the test never added one. Fixed by calling
   `addMeeting` before `publishOffering`.
2. The test's `yearBase` (2300+, fine for an academic year label) was also used for the student number and
   `enrolmentYear` -- `STUDENT_ID_PATTERN` requires a `19`/`20` prefix, so every enrolment was rejected.
   Decoupled: a fixed `enrolmentYear = 2021` for the student, `yearBase` kept only for the semester label.
3. `submitClassAction`'s real redirect target omits `semesterId` from the URL (`/admin/grades?offeringId=…`
   only) -- the test asserted a URL that never occurs. Fixed the assertion to match actual app behavior.
4. `approveSubmissionAction`'s real redirect returns to the same submission detail page, not the queue list
   -- same category of fix, assertion corrected to check for the resulting `CLOSED` status instead.
5. The cleanup itself needed five separate fixes before a run left zero residue: `gradeRecord` matched on
   the wrong column (same DEV-15-class bug); `academic_record`, `grade_submission`, `offering_meeting`, and
   `student_semester_summary` were each missed entirely, each with its own `onDelete:"restrict"` reference
   blocking the offering/semester delete chain -- confirmed one at a time, each only becoming visible once
   the previous blocker was removed. Each left a leftover semester that then hit Section 13.6's
   one-semester-per-state-institution-wide rule and blocked the *next* run, compounding the debugging cycle;
   all residue was identified by direct query (matching the test's own fixture naming/label patterns) before
   deletion, and cleaned up with one-off scripts (not committed).
**Result:** after all five cleanup fixes, two full end-to-end runs left zero residue and `npm run
db:reconcile` reported zero mismatches against 79 real students afterward. The test itself (Admin enters
grades → submits → a different Super Admin approves → grade publishes, verified against the real database)
passes reliably now.
**Approval status:** Not a deviation requiring approval -- test-code bug fixes, matching DEV-15's pattern
exactly. Recorded at this length because five fixes in one file, all invisible without a real run, is itself
the evidence for why "written but typechecked" was never claimed as "verified" for this file.

### DEV-17 — Professional UI/visual redesign pass across every page, on branch `design/professional-ui`

**Date:** 1 Sep 2026, after the full test suite had already been proven to pass once against real Supabase
(DEV-15/DEV-16).
**Context:** The system had been correctness-complete since Stage 11 but was visually plain -- default
`<button>`s, ad hoc `red-50`/`amber-50` Tailwind strings repeated per page, no shared navigation, and the
`<title>` still the literal `create-next-app` default. The project owner asked for a full styling/layout pass
across every route, explicitly out of scope: any change to business logic, `"use server"` function bodies,
test assertion logic, or the CSP.
**What changed:**
1. A real design system: a navy/warm-neutral palette and semantic status colors defined as Tailwind 4
   `@theme` tokens in `src/app/globals.css` (this project has no `tailwind.config.js`), plus small local
   components under `src/components/ui/` (`Button`, `Badge`, `Card`, `Alert`, `Table`, form field wrappers,
   `PageHeader`) -- no new UI framework, matching the plan's existing "Tailwind utility classes only" stance.
2. A persistent header/nav (`src/components/layout/Header.tsx`), added in `src/app/layout.tsx`, showing
   institution branding, the signed-in user and role, role-based navigation (reusing the link lists that used
   to live only in `src/app/portal/page.tsx`, now centralized in `src/components/layout/navLinks.ts`), and a
   new sign-out control (`src/app/actions.ts`) -- there was previously no way to sign out from inside the app
   at all. Every page used to be a lone `<main>` with no shell; this was the single highest-impact change.
3. `lucide-react` added as a dependency (inline SVG icon components, no external asset requests, so no CSP
   change needed) -- the one exception the brief allowed without stopping to ask first.
4. Every route in the brief's route list restyled page by page, role-group by role-group. No visible
   heading/button/form-label text was renamed; every interactive element that was a real `<button>`/`<a>`/
   labeled `<input>` stayed one. The three files with per-row `aria-label`s added during the Stage 11
   security review (`ClassEntryForm.tsx`, `grade-review/[submissionId]/page.tsx`, `admin/historical/page.tsx`)
   kept those `aria-label`s verbatim. The student portal home page stayed a plain informational page, not a
   charts dashboard (OOS-09); the semester grade sheet's print path stayed a `@media print` stylesheet against
   server-rendered HTML, not a client-side PDF library.
5. Fixed the page `<title>` (`src/app/layout.tsx`'s metadata) from the unchanged `create-next-app` default to
   a real templated title, with most individual pages now setting their own via a `metadata` export.
**Not changed:** `src/lib/**`, `"use server"` action bodies, `drizzle/` migrations, `e2e/*.spec.ts` test
logic, and `src/proxy.ts`'s CSP -- no test assertion needed updating, since no visible text changed.
**Approval status:** This is the task the project owner asked for directly; not a deviation. Full validation
(typecheck, lint, build, the full `npm run test` suite, `npm run db:reconcile`, and the full Playwright e2e
suite) was run against real Supabase before pushing the branch; results are recorded in the session's final
report rather than duplicated here. Pushed to `design/professional-ui`, not merged to `main` -- that remains
the project owner's decision, since `main` auto-deploys to the live production site.

### DEV-18 -- Ten demo students seeded into the live database for a walkthrough

**Date:** 2 Sep 2026, at the project owner's explicit request ("populate the system with demo data ... focus
should be on the student data"), confirmed via three scoping questions before writing anything: proceed on the
single live Supabase project (DEV-01, no separate dev/staging environment exists), advance the real 2026/2027
First Semester out of Draft so planning could be demoed against the real course catalogue rather than a
throwaway one, and mark every demo record with a literal `"Demo Student —"` firstName so it's trivially
findable and removable.
**Context:** Before writing any data, an inspection pass found the live database already carries substantial
orphaned test-fixture residue from earlier stages' automated test runs -- stray academic years (e.g.
"2099/2100", "2183/2184", "2206/2207" through "2208/2209"), a semester stuck in GRADE_SUBMISSION under one of
them, dozens of DISABLED e2e/test admin accounts, and a handful of test-named departments (including one,
`CECS 101` under the COCE college, with a stray `maxCreditsOverride: 1`). None of that was touched or cleaned
up here -- out of scope for this task, flagged to the project owner instead.
**What changed:**
1. The real "2026/2027 First Semester" (154 published offerings, imported in Stage 8) was advanced
   DRAFT -> OPEN -> REGISTRATION through the normal Admin `transitionSemester` path -- a real, visible
   calendar action, not reverted by the cleanup script below.
2. Two new retrospective CLOSED semesters were created via `createRetrospectiveSemester`, each as a
   `sequence: 2` ("Second Semester") sibling under an *existing* academic year so no pre-existing row was
   touched: 2024/2025 Second Semester (Feb-Jun 2025) and 2025/2026 Second Semester (Feb-Jun 2026). These exist
   solely to host the demo students' historical grades.
3. Ten students were enrolled via the real `enrollStudent` service function (same path the Admin UI uses, same
   Auth-user-plus-app_user-plus-student transaction, same audit trail), spread across ten different real
   departments with real 2026/2027 offerings. Every one has `firstName === "Demo Student —"` and a reserved
   student-number suffix (`90`-`93`) within its admission year, e.g. `202490`.
4. Historical grades were entered via the real `enterHistoricalSemester` function (7 of the 10 students; the
   other 3 are freshmen or intentionally have no history), producing a spread of CGPAs from 1.54 to 3.49 --
   including one student (Emmanuel Tarr, `202491`) with a prior F and one (Samuel Konneh, `202592`) with a
   prior D- in a major-department course, both of which correctly auto-flag as mandatory retakes when the same
   course reappears in a later plan.
5. Course plans for 2026/2027 were built and driven through every lifecycle state via the real `planning.ts`
   functions: 5 left `SUBMITTED` (awaiting Admin review -- the core ask), 2 `APPROVED` (with real
   `registration` rows created), 1 `REJECTED` (with a real rejection reason), 1 `DRAFT` (never submitted), and
   1 student with no plan at all.
**Not changed:** no existing student, admin/super-admin account, department, course, or the orphaned
test-fixture residue described above.
**Removal:** `scripts/removeDemoData.ts` (committed) deletes exactly these ten students and everything that
references them (registrations, plan items, plans, academic records, GPA summary caches, the `student` and
`app_user` rows, and the Supabase Auth user) in FK-safe order, identified the same way an Admin would find them
in the UI -- `firstName === "Demo Student —"`. Supports `--dry-run` to preview first. It deliberately leaves
the 2026/2027 semester's REGISTRATION state and the two retrospective historical semesters alone -- reverting
calendar state is a separate, human decision, not bundled into a data-cleanup script.
**Approval status:** Requested directly by the project owner; not a deviation from the plan.
