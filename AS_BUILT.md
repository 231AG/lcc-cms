# As-Built Note — Phase 1

Written at the end of Stage 11. Records where the delivered system departs from
`LCC_EPortal_Phase1_Development_Plan_v2.1.pdf`, and what "done" actually means for this build. Full detail
and approval trail for every item below lives in `DECISIONS.md`; this is the synthesis, not a replacement.

## What was built

All eleven planned stages have working code:

1. **Foundation and Platform** — migrations, CI, audit infrastructure, transaction/idempotency wrapper.
2. **Identity and RBAC** — Student-ID login, forced first-password-change, the single permission-kernel
   table driving both service-layer checks and RLS.
3. **Academic Structure** — colleges, departments, courses, prerequisites with cycle detection.
4. **Calendar and State Machine** — the six-state semester machine, all illegal transitions refused.
5. **Students and Profiles** — enrolment, search, admission-forfeiture status.
6. **Historical Records Import** — the unified `academic_record` table, conflict/duplicate handling.
7. **GPA/CGPA Engine** — the nine-point scale, mandatory repeats, reconciliation queries.
8. **Offerings and Scheduling** — sections, instructors, structured meeting times.
9. **Course Planning** — the plan state machine, prerequisite override, atomic approval.
10. **Grade Management Lifecycle** — submit/approve/publish/lock/correct, full segregation of duties.
11. **Hardening, Export, Backup and Go-Live** — see below; the one stage that is *not* fully complete.

## Where this build departs from the plan

Every entry below is recorded in full in `DECISIONS.md`, with rationale and approval status. Summarized:

| ID | Departure | Why it matters |
|---|---|---|
| DEV-01 | One Supabase project for dev/staging/prod, not three separate ones | No isolation between test and (eventual) real data in the same project |
| DEV-03 | Super Admin's backward semester transition runs through the superuser connection, not RLS | Documented exception; RLS can't express conditional role+state logic |
| DEV-04, ASM-21 | Admission forfeiture scoped to newly-enrolled students only, narrower than the plan's literal wording | Confirmed correct by project owner; the report itself still isn't built |
| DEV-05 | Historical record correction is direct Admin-only, not two-key like a grade correction | Simpler than the plan's recommendation; can be upgraded later without a data model change |
| DEV-06 | Historical conflict adjudication has no named role in software | DEC-26 stays open pending the Registrar's office naming one |
| DEV-07 | Prerequisite override reachable on DRAFT/REJECTED plans, not only SUBMITTED | Resolves a real gap in the plan's own stated rules, not a new policy |
| **DEV-09** | **No backup or PITR configured; single free-tier project used as "production"** | **The most significant departure. See below.** |
| DEV-10 | Security review is an internal code-level self-review, not third-party | Matches the plan's own FUTURE/Phase-2 framing for a formal pentest |
| DEV-12 | CI cannot run 9 of 20 integration test files, or Playwright e2e at all | Needs real Supabase Auth; no test project was provisioned |
| DEV-14 | DER-25's 150KB student-page JS budget is measurably exceeded (~174KB gzip on `/login`) by framework runtime, not app code | Real-world requirement (interactive <3s on 3G) is met regardless — see `DECISIONS.md` for the measured numbers and recommendation |

## The honest answer to "is this production-ready?"

**No, not in the plan's own sense of Go-Live — and it should not be described that way until DEV-09 is
resolved.** The plan's Stage 11 acceptance criteria for gate G11 explicitly require: *"A restore from backup
has been performed and verified... The security review is complete with no open critical or high
finding... UAT is signed off by the Admin office and the Super Admin."*

Status against each:
- **Backup/restore**: not configured, not rehearsed. See `docs/BACKUP_RESTORE_RUNBOOK.md`. **This is a
  real, accepted operational risk** — there is currently no recovery path from data loss.
- **Security review**: complete as an internal self-review (`SECURITY_REVIEW.md`), with several real
  findings fixed during the review itself (forced-password-change bypass, missing security headers, a
  non-HttpOnly session cookie). No critical/high findings remain open; the accepted gaps (rate limiting,
  correlation IDs, a dev-only dependency vulnerability with no non-breaking fix available) are all
  RECOMMENDED-tier, documented, and low real-world risk given this system's threat model.
- **UAT**: not started. This requires the College's actual Admin office staff and real paper records — it
  cannot be performed by an AI agent working alone, and has not been attempted.
- **Regression suite**: passes for everything CI can actually run (lint, typecheck, build, 120 unit/RLS
  tests). Nine integration test files and all Playwright e2e specs are excluded from CI by necessity (they
  need a real Supabase Auth backend) and must be run manually against a real project.

**What this build actually is: a functionally complete Phase 1 pilot**, correct against its own extensive
test suite and the plan's business logic, that has not yet been proven safe to hold real, unrecoverable
student data, and has not yet been validated by the people who will actually use it. Both of those are real
work, not paperwork, and neither can be finished from inside this session.

## What's needed to actually reach Go-Live

In roughly the order it makes sense to do them:

1. Decide on DEC-31 (production database tier) and DEV-09 (backup) — this is a cost/timeline decision only
   the project owner can make, not an engineering one.
2. Once decided: provision, configure PITR, and **rehearse a real restore** per
   `docs/BACKUP_RESTORE_RUNBOOK.md`.
3. Run the excluded test suites and e2e specs against a real Supabase project (see the local execution
   checklist) and fix anything they surface — they have not been run even once against real Auth in this
   build.
4. Schedule and run UAT with the Admin office, using real (or realistic) paper records, per the plan's own
   Stage 6/10 recommendation to test the two highest-risk screens with real users early.
5. Resolve the remaining open, Registrar/VPAA-dependent items in `DECISIONS.md`/`ASSUMPTIONS.md` (DEC-14
   confirmed; DEC-12's override date, DEC-26's adjudicator role, and the handful of low-risk ASM-* items
   still marked unvalidated).
6. Sign off G11 formally, per the plan's own gate procedure (Section 26).

Only after all of the above should this system be described as having reached the plan's Go-Live.
