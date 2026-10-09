# Phase 0 — System map (read-only recon)

Audited commit: `ac50f9d` (= `main` at PR #22 `c68d0d2` + the older-letters transcript fix). Audit date: 2026-10-07.

## 0. How this audit is being run (safety)

- **No production access of any kind.** This checkout has no `.env.local` (only `.env.example`), so no environment here can point at the production Supabase project. All dynamic testing runs against **local Postgres 16 (port 54329, database `lcc_tr`, built only from this repo's migrations + seed)** and a **local Supabase Auth (GoTrue v2.180.0 binary)** on `127.0.0.1`. Keys used are throw-away local values, never real ones.
- Phases 0–3 are read-only for the application: no file under `src/`, `drizzle/`, `public/`, `scripts/` or config was modified. Everything written is under `security-audit/`.
- The Excel-template commit and the older-letters fix commit on the local branch are unrelated to this audit and untouched. The `security/audit-fixes` branch has **not** been created yet (nothing to fix until you approve).

## 1. Stack — confirmed from the repo (and where your brief differs)

| Item | Actual |
|---|---|
| Framework | Next.js **16.3.5**, **App Router** only (no `pages/`), React 19.2.8. Middleware is `src/proxy.ts` (Next 16 renamed middleware→proxy, Node runtime). |
| Auth | Supabase Auth (GoTrue) via `@supabase/ssr` 0.12.5 / `@supabase/supabase-js` 2.112.4. **No Supabase client exists in the browser** — every read/write is Server Component / Server Action / Route Handler. Student ID → synthetic email `<id>@students.lcc-eportal.invalid`; staff → `<username>@staff.lcc-eportal.invalid`. |
| Database access | **Drizzle ORM** 0.45.2 over the `postgres` driver on `DATABASE_URL` (a privileged role that bypasses RLS). Reads for the signed-in user go through `asUser()` (`SET role authenticated` + `request.jwt.claim.sub`, so RLS applies); writes use the privileged connection, gated by `assertCan()` in the service layer. **Not Prisma** (brief said "Prisma or not": not). |
| Client state | **No Zustand**, no client state library — there is nothing to leak between users on a shared device from a store (will still verify browser storage). |
| Validation | `zod` is a declared dependency but **imported in zero files**. Validation is hand-written per service function. |
| Hosting | Vercel (per `docs/DEPLOYMENT_RUNBOOK.md`; no `vercel.json`). Migrations are applied by `.github/workflows/migrate.yml` only when the `PRODUCTION_DATABASE_URL` secret exists (currently absent — SQL is run by hand). |
| Edge functions / storage | **None.** No Supabase Storage buckets, no edge functions, no `supabase/` directory. Student photos are `bytea` in `app.student_photo` served by a route handler. |
| Security headers | Set in `src/proxy.ts` (not `next.config.ts`, which is empty): nonce-based CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production. |
| Tests / CI | Vitest (44 files, 399 tests pass locally against the local DB; CI excludes 9 integration files that need real Supabase Auth), Playwright e2e specs (not runnable in CI). CI = migrate → seed → fixtures → lint → typecheck → test:ci. |

## 2. Where authorization is actually enforced

Layers, outermost first (each to be tested in Phase 1, not assumed):

1. **`src/proxy.ts`** — runs on every request except static assets/health. Does: security headers, 1-hour idle sign-out (HMAC-signed activity cookie), and the forced-first-login redirect to `/change-password` (DB lookup of `must_change_password`). It states plainly that it **is not the authorization boundary**: unauthenticated requests are passed through to the page.
2. **Page-level gate** — every `page.tsx` calls `getCurrentActor()` (a real `auth.getUser()` + `app_user` row with `status = ACTIVE`) and compares `actor.role`. Pages render "Not available to your role" rather than 403/redirect.
3. **Server Actions** — all 79 call `requireActor()` (verified by scan; only `loginAction` and `signOutAction` do not, as intended) and then a service function that calls `assertCan(actor, '<action>')` against the `app.permission` matrix (deny by default; 60-second in-memory cache).
4. **Route handlers** — `requireActor()` + inline role check (CSV exports) or RLS-scoped read (photo).
5. **Postgres RLS** — all 25 `app`/`audit` tables have RLS enabled (23 forced; `grade_scale` and `institution_setting` enabled but not forced). Student-facing SELECT policies are scoped to `auth.uid()`. Reads via `asUser()` rely on this as the *only* boundary (no service-layer ownership check for most reads).
6. **DB constraints/triggers** — segregation-of-duties CHECKs, `app_user.role` immutable trigger, minimum-one-active-Super-Admin trigger, `audit.audit_log` INSERT-only grant for application roles.
**UI-only controls (to be confirmed not to be the sole control):** the sidebar menu per role (`src/components/layout/navLinks.ts`) and hidden buttons. Every page and action re-checks, per the scans above.

## 3. Roles and what each may do (from the seeded `app.permission` matrix)

`Y` = allowed, `-` = denied. Source: local DB seeded from `src/lib/db/seed.ts`.

| Action | STUDENT | ADMIN | SUPER_ADMIN |
|---|---|---|---|
| `calendar.manageAcademicYear` | - | Y | - |
| `calendar.manageSemester` | - | Y | - |
| `calendar.transitionSemester` | - | Y | Y |
| `export.runSemesterExport` | - | Y | Y |
| `grade.decideCorrection` | - | - | Y |
| `grade.manageClass` | - | Y | - |
| `grade.requestCorrection` | - | Y | - |
| `grade.review` | - | - | Y |
| `gradingPolicy.view` | Y | Y | Y |
| `historical.correctRecord` | - | Y | - |
| `historical.createRetrospectiveSemester` | - | Y | - |
| `historical.enterRecord` | - | Y | - |
| `historical.setImportStatus` | - | Y | - |
| `historical.voidRecord` | - | Y | - |
| `identity.changePassword` | Y | Y | Y |
| `identity.createStaffAccount` | - | - | Y |
| `identity.createStudentAccount` | - | Y | - |
| `identity.disableAccount` | - | - | Y |
| `identity.enableAccount` | - | - | Y |
| `identity.resetStudentPassword` | - | Y | - |
| `identity.updateStudentProfile` | - | Y | - |
| `institution.manageSignatories` | - | Y | - |
| `offering.manage` | - | Y | - |
| `planning.manageOwnPlan` | Y | - | - |
| `planning.manageRegistration` | - | Y | - |
| `planning.manageStudentPlan` | - | Y | - |
| `planning.reviewPlan` | - | Y | - |
| `structure.manageCollege` | - | Y | - |
| `structure.manageCourse` | - | Y | - |
| `structure.manageDepartment` | - | Y | - |
| `structure.managePrerequisite` | - | Y | - |

**Matches your business rules:** Students manage only their own plan; Admin enrols students, plans for students, creates courses/semesters/colleges/departments, enters/submits grades and historical records; Super Admin only transitions semesters, reviews/approves grades, decides corrections, manages staff accounts and views the audit log — and is **denied** student registration, course/semester/structure creation and grade entry.

### Where the app differs from the brief (so findings are judged against the real rules)

- **Semester states are four, not six:** `DRAFT → OPEN → IN_PROGRESS → CLOSED` (+ Super-Admin-only reopen `CLOSED → IN_PROGRESS` with a reason). OPEN = planning/registration; IN_PROGRESS = grade entry. (Migration `0024_semester_four_states.sql`.) Grade lifecycle is separate: `DRAFT → SUBMITTED → PUBLISHED → LOCKED`.
- **Grading scale is plus/minus, not A=4.0…F:** A+ 4.00, A- 3.70, B+ 3.30, B- 2.70, C+ 2.30, C- 1.70, D+ 1.30, D- 0.70 (minimum pass), F 0.00; plus older plain A/B/C/D (4/3/2/1) on past sheets, `I` (not counted), `NG` (not counted, settled within 2 semesters). Score→letter rounds half up (59.5→D-). The brief's 90/80/70/60 scale is **not** what the College approved (`GRADING_RULES.md`), so GPA edge values tested are 59.5/60/94.5/95 etc.
- **Retakes:** earlier attempt marked `R`, excluded from CGPA, credits counted once.
- **Student "status" vs level:** `student.status` (ACTIVE/INACTIVE/SUSPENDED/GRADUATED/ADMISSION_FORFEITED) is enrollment; the College's "Status" (Freshman…Senior) is computed from earned credits.

## 4. Inventory

### 4.1 Pages (38)

`/(portal)/admin/accounts`, `/(portal)/admin/audit`, `/(portal)/admin/calendar`, `/(portal)/admin/export/[semesterId]/print`, `/(portal)/admin/export`, `/(portal)/admin/grade-corrections`, `/(portal)/admin/grade-review/[submissionId]`, `/(portal)/admin/grade-review`, `/(portal)/admin/grades`, `/(portal)/admin/historical/import`, `/(portal)/admin/historical`, `/(portal)/admin/login-slips`, `/(portal)/admin/no-grades`, `/(portal)/admin/offerings`, `/(portal)/admin/offerings/print`, `/(portal)/admin/planning/[planId]/control-sheet`, `/(portal)/admin/planning/[planId]`, `/(portal)/admin/planning`, `/(portal)/admin/registrations`, `/(portal)/admin/structure/import`, `/(portal)/admin/structure`, `/(portal)/admin/student-grades`, `/(portal)/admin/student-plan`, `/(portal)/admin/students/[id]/grade-sheet/[semesterId]`, `/(portal)/admin/students/[id]`, `/(portal)/admin/students`, `/(portal)/admin/students/print`, `/(portal)/admin/transcripts`, `/(portal)/change-password`, `/(portal)/grading-policy`, `/(portal)/planning`, `/(portal)/portal/grade-sheet/[semesterId]`, `/(portal)/portal/grades`, `/(portal)/portal`, `/(portal)/portal/transcript`, `/access-denied`, `/login`, `/`

### 4.2 Route handlers (7)

- `/(portal)/admin/export/[semesterId]/results/route.ts`
- `/(portal)/admin/export/[semesterId]/route.ts`
- `/(portal)/admin/offerings/export/route.ts`
- `/(portal)/admin/students/export/route.ts`
- `/api/health/route.ts`
- `/api/session/ping/route.ts`
- `/api/students/[id]/photo/route.ts`

### 4.3 Server Actions (79 in 23 files)

- `(portal)/admin/accounts/actions.ts`: createStaffAccountAction, disableAccountAction, enableAccountAction
- `(portal)/admin/calendar/actions.ts`: createAcademicYearAction, createSemesterAction, transitionSemesterAction, deleteSemesterAction
- `(portal)/admin/grade-corrections/actions.ts`: requestCorrectionAction, decideCorrectionAction
- `(portal)/admin/grade-review/actions.ts`: approveSubmissionAction, rejectSubmissionAction
- `(portal)/admin/grades/actions.ts`: saveClassDraftAction, clearDraftGradeAction, submitClassAction
- `(portal)/admin/historical/actions.ts`: correctHistoricalRecordAction, voidHistoricalRecordAction, markImportCompleteAction, reopenImportStatusAction
- `(portal)/admin/historical/import/actions.ts`: previewGradeSheetImportAction, commitGradeSheetImportAction, checkManualEntryAction, saveManualEntryAction
- `(portal)/admin/login-slips/actions.ts`: issueLoginSlipsAction
- `(portal)/admin/offerings/actions.ts`: createOfferingAction, updateOfferingAction, deleteOfferingAction, publishOfferingAction, cancelOfferingAction, reinstateOfferingAction, rescheduleMeetingsAction, addMeetingAction, removeMeetingAction
- `(portal)/admin/planning/actions.ts`: deletePlanAction, approvePlanAction, rejectPlanAction, approvePlanItemAction, rejectPlanItemAction, overrideScheduleConflictAction, overridePrerequisiteAction, findPlanAction
- `(portal)/admin/registrations/actions.ts`: registerDirectAction, dropRegistrationAction
- `(portal)/admin/structure/actions.ts`: createCollegeAction, updateCollegeAction, toggleCollegeActiveAction, createDepartmentAction, updateDepartmentAction, toggleDepartmentActiveAction, createCourseAction, updateCourseAction, toggleCourseActiveAction, addPrerequisiteAction, removePrerequisiteAction
- `(portal)/admin/structure/import/actions.ts`: previewCourseImportAction, commitCourseImportAction
- `(portal)/admin/student-grades/actions.ts`: requestCorrectionFromStudentGradesAction
- `(portal)/admin/student-plan/actions.ts`: startStudentPlanAction, addStudentPlanItemAction, removeStudentPlanItemAction, submitStudentPlanAction, deleteStudentDraftPlanAction
- `(portal)/admin/students/[id]/grade-sheet/[semesterId]/actions.ts`: logGradeSheetPrintAction, updateSignatoriesAction
- `(portal)/admin/students/actions.ts`: enrollStudentAction, resetStudentPasswordAction, updateStudentProfileAction, uploadStudentPhotoAction, removeStudentPhotoAction
- `(portal)/admin/transcripts/actions.ts`: logTranscriptPrintAction
- `(portal)/change-password/actions.ts`: changePasswordAction
- `(portal)/planning/actions.ts`: startPlanAction, addPlanItemAction, removePlanItemAction, submitPlanAction, deleteDraftPlanAction
- `(portal)/portal/actions.ts`: logSemesterPrintAction, logOwnTranscriptPrintAction
- `actions.ts`: signOutAction
- `login/actions.ts`: loginAction

### 4.4 Database (schemas `app`, `audit`)

| Table | RLS | FORCE | Policies |
|---|---|---|---|
| `app.academic_record` | yes | yes | 2 |
| `app.academic_year` | yes | yes | 4 |
| `app.app_user` | yes | yes | 3 |
| `app.college` | yes | yes | 4 |
| `app.course` | yes | yes | 4 |
| `app.course_offering` | yes | yes | 4 |
| `app.course_plan` | yes | yes | 1 |
| `app.course_plan_item` | yes | yes | 1 |
| `app.course_prerequisite` | yes | yes | 3 |
| `app.department` | yes | yes | 4 |
| `app.grade_correction_request` | yes | yes | 1 |
| `app.grade_record` | yes | yes | 2 |
| `app.grade_scale` | yes | no | 1 |
| `app.grade_submission` | yes | yes | 1 |
| `app.idempotency_key` | yes | yes | 0 |
| `app.institution_setting` | yes | no | 1 |
| `app.offering_meeting` | yes | yes | 4 |
| `app.permission` | yes | yes | 1 |
| `app.registration` | yes | yes | 1 |
| `app.semester` | yes | yes | 3 |
| `app.student` | yes | yes | 2 |
| `app.student_cumulative_summary` | yes | yes | 2 |
| `app.student_photo` | yes | yes | 2 |
| `app.student_semester_summary` | yes | yes | 2 |
| `audit.audit_log` | yes | yes | 1 |

- **Views:** none. **RPC / SQL functions:** `app.current_user_role()` (SECURITY DEFINER, `search_path` pinned to `app, pg_temp`; returns the caller's role, does **not** check `status = ACTIVE`), `app.enforce_role_immutable()`, `app.enforce_min_one_super_admin()` (triggers, not callable RPCs).
- **Triggers:** only on `app.app_user` (role immutable; at least one active Super Admin). **None on `audit.audit_log`** — its immutability is by privilege (no UPDATE/DELETE grant to `authenticated`/`service_role`), not by trigger.
- **Roles:** `anon` has no table privileges in `app`/`audit`; `authenticated` has SELECT on most tables, write privileges (policy-limited to ADMIN) on 8 configuration tables, and INSERT on `audit.audit_log`; `service_role` has full DML (bypasses RLS; used only server-side).
- **Policies/grants dumps:** `security-audit/data/policies.txt`, `security-audit/data/grants.txt`, `security-audit/data/permission-matrix.txt`.

## 5. Baseline (before any change)

| Check | Result |
|---|---|
| `npm ci` / install | node_modules present and in sync (`package-lock.json` unchanged) |
| `tsc --noEmit` (`npm run typecheck`) | **Pass**, no errors |
| `npm run lint` | **Pass**, no warnings |
| `next build` | **Pass** (compiled in ~16s, TypeScript ~15s, all routes dynamic, Proxy present) |
| `npm run test:ci` | **44 files / 399 tests pass** |
| Client bundle | 0 browser source maps; none of `SERVICE_ROLE`, `DATABASE_URL`, `postgres://` in `.next/static`; the Supabase URL/anon key are not in the browser bundle at all |

Baseline is green — nothing pre-existing to report.

## 6. Hypotheses queued for Phase 1 (from recon; each is tested before it becomes a finding)

- H1 `logGradeSheetPrintAction` / `logSemesterPrintAction`: no role check, attacker-chosen `studentId`/`semesterId` → any signed-in user (incl. a student) can write audit rows about other students.
- H2 `audit.audit_log` INSERT policy is `WITH CHECK (true)` for `authenticated`: forgeable audit entries by any authenticated DB session, **if** the `audit` schema is reachable (PostgREST "Exposed schemas" — a Supabase dashboard setting this audit cannot see; will give a SQL to check).
- H3 Admin password reset / login-slip reissue sets `must_change_password` but does **not** revoke the student's existing sessions, and the forced-change path needs no current password → an old (stolen) session could take the account over after a reset.
- H4 No rate limiting / lockout in the app on `loginAction`; students' passwords can be 6 chars; student IDs are sequential and guessable.
- H5 Login timing/response differences revealing which IDs exist.
- H6 Unauthenticated hits on CSV export handlers return 500 (plain `Error` from `requireActor`) instead of 401.
- H7 `GET /api/students/<non-uuid>/photo` → unhandled DB error (500).
- H8 `current_user_role()` ignores `status`; a DISABLED staff account's still-valid JWT would keep RLS write rights **if** used against the DB directly (not through the app).
- H9 Super Admin accounts have no MFA (plan defers it); they approve grades and create staff.
- H10 `zod` unused: server-side validation gaps (scores >100, negative hours, huge strings, extra fields) to be probed per action.
- H11 No DB-level block on UPDATE/DELETE of `audit.audit_log` for the owner role (relevant to "is the audit log really immutable").
- H12 State-machine bypass: grade entry/edit/publish and plan changes outside the allowed semester states; concurrent double-approval races.
- H13 `x-middleware-subrequest` / proxy bypass; open redirect via login params; error pages leaking details.
- H14 `db/client.ts` and `supabase/admin.ts` lack `import "server-only"` (defence-in-depth against a future client import).

