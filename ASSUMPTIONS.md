# Assumption Register — LCC E-Portal Phase 1

Seeded from `LCC_EPortal_Phase1_Development_Plan_v2.1.pdf`, Section 35 (25 Aug 2026). Full detail lives in the
plan; this file tracks status and validation as implementation proceeds.

| ID | Assumption | Affects | Validation route | Status |
|---|---|---|---|---|
| ASM-01 | One institution, one campus, one instance | Whole architecture | Ask VPAA | Confirmed — owner confirmed 2026-08-29 |
| ASM-02 | English; Africa/Monrovia (UTC+0); dates `DD Mon YYYY`; 24h times | All screens | Confirm at first gate demo | Unvalidated |
| ASM-03 | Low thousands of students; low hundreds of thousands of records over a decade | Indexing, pagination | Ask for enrolment figures | Confirmed — owner confirmed 2026-08-29, current indexing/pagination sizing stands |
| ASM-06 | Any student may register for any department's course | Course planning | Ask Registrar | Confirmed — owner confirmed 2026-08-29, matches current Stage 9 behavior |
| ASM-07 | Admin override applies only to prerequisites, not the 21-credit ceiling | Course planning | DEC-36; raise at UAT if needed | Unvalidated |
| ASM-09 | Temporary passwords handed over in person/on paper | Account creation | Confirm with Admin office | Unvalidated |
| ASM-10 | Lecturers identified by name only, no account | Offerings, print output | Confirm at G8 | Unvalidated |
| ASM-11 | A course offering does not span semesters | Offerings, records | Ask Registrar | Unvalidated |
| ASM-12 | Admin office has internet reliable enough for daily work, even if slow | Whole architecture | Ask Admin office directly before Stage 6 | Confirmed — owner confirmed 2026-08-29, no offline-tolerance design needed |
| ASM-13 | Admin and Super Admin roles held by different people | Segregation of duties | Confirm with VPAA (risk R-16) | Confirmed — owner confirmed 2026-08-29 (see DECISIONS.md pre-coding administrative table) |
| ASM-14 | Grade sheets arrive per class, matching the entry screen | Grade entry design | Real sample inspected 2026-08-28 (`Semester-II Grade Sheet II.pdf`) | Partially confirmed — the sample is the **student-facing semester output** (one student, all courses, with GPA and two dean signatures), not a per-class input roster; A-12's class-entry design still has no real per-class paper sample to check against. Also shows plain letter grades (A, B) rather than the confirmed A+/A- scale, and two fields (Minor, Class standing) the `student` table doesn't track — noted, not treated as new scope for Phase 1. |
| ASM-15 | Past semesters can be created retrospectively, directly Closed | Historical import | Confirm at G6 | Unvalidated |
| ASM-16 | College accepts hosted infrastructure outside Liberia | Deployment | DEC-30 | Confirmed — DEC-30 chose West EU (London/Ireland) hosting, 25 Aug 2026 |
| ASM-17 | Rejected the plan's literal reading (auto-Complete at enrolment). Instead: every student starts at the schema default (NOT_STARTED) regardless of whether they're a genuinely new admit or an existing LCC student being onboarded onto the e-portal with real history to backfill. Stage 6 gives the Admin an explicit "mark import Complete" action to use whenever appropriate for that student -- including immediately, for one with nothing to add. No automatic status change is tied to enrolment itself. | Import status, GPA display | Owner confirmed 2026-08-27 (see DECISIONS.md DEV-05): most near-term enrolments are existing LCC students with real history to backfill, not fresh admits, so an enrolment-time auto-Complete rule would be wrong for the common case | Confirmed |
| ASM-18 | No SMS/email in Phase 1, including password reset | Identity | Confirm with VPAA | Unvalidated |
| ASM-19 | "Most recent attempt" counts even when worse (carried from source doc) | CGPA | Show Registrar fixture F-13 | Confirmed — owner confirmed 2026-08-29, matches current Stage 7 engine behavior |
| ASM-20 | "Major course" = course owned by student's own department | Mandatory repeats | **Ask Registrar before Stage 7** | Confirmed — owner confirmed 2026-08-29, matches current Stage 7 engine behavior |
| ASM-21 | Admission forfeiture targets a newly-enrolled student who never registers for two consecutive semesters after account creation (not any Active student who later lapses); Admin (not Super Admin) reactivates after due process | Student status / forfeiture | Owner confirmed the trigger scope 2026-08-26 (see DECISIONS.md DEV-04); Admin-only reactivation matches existing REQ-R04 RBAC split, no change needed | Confirmed — narrower scope than plan's literal Section 12.6 wording; candidate-report feature itself still waits on `registration` data (Stage 8+) |
| ASM-22 | 132-credit graduation total applies equally to every BSc programme | Graduation progress display | Ask Registrar whether any department differs | Unvalidated |

Six assumptions from the original v1.0 plan (ASM-04, 05, 08) were retired by the College's 25 Aug 2026 decisions —
see plan §35.1. Not tracked here as they are now facts, not assumptions.
