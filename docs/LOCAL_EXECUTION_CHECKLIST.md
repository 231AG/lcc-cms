# Local Execution Checklist — After This Session

Everything in this checklist requires your laptop, real Supabase credentials, or GitHub access I don't have
from this session. Follow in order. Each step names the exact command, what success looks like, and what to
do if it fails.

## 0. Prerequisites

- Node.js 20+, npm, Docker Desktop (or a local Postgres) — see `docs/SETUP.md` if you need the full
  from-scratch setup.
- **A real Supabase project** (this build only ever had a placeholder one). Get from Project Settings → API:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Per DEV-01/DEV-09
  this can be the same single project used for everything for now.
- **GitHub access fixed first** — install the Claude GitHub App for the `231AG` org
  (https://github.com/apps/claude/installations/select_target) or reconnect the connector, so this
  session's work can actually be pushed. Tell Claude to retry the push once done, or push yourself per step 1.

## 1. Get the branch

```bash
git clone https://github.com/231AG/lcc-cms.git   # if you don't have a local clone yet
cd lcc-cms
git fetch origin
git checkout stage/11-hardening-go-live
git pull origin stage/11-hardening-go-live
```
**Expect:** 17 commits ahead of `stage/10-grade-management`, working tree clean.
**If it fails:** if the branch doesn't exist on GitHub yet, the push from this session hasn't landed —
resolve GitHub access first (see prerequisites), then have Claude push, then retry this step.

## 2. Install dependencies

```bash
npm ci
```
**Expect:** installs cleanly, ends with a summary line (something like "added 432 packages"). A handful of
deprecation warnings are normal and not errors.
**If it fails:** delete `node_modules` and `package-lock.json`-derived cache (`npm cache clean --force`),
retry. A real failure here (not a warning) means a Node version mismatch — confirm Node 20+.

## 3. Set environment variables

```bash
cp .env.example .env.local
```
Edit `.env.local`:
- `DATABASE_URL` — leave as the Docker default for now (step 4 starts that Postgres), or point it at your
  Supabase project's pooler connection string (transaction mode) if you want to test against real Supabase
  from the start.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — your real
  Supabase project's values. **This step is mandatory** for anything in steps 9-13 below (the tests and e2e
  specs this session could not run) — those all need a real Supabase Auth backend, not a placeholder.

## 4. Start PostgreSQL

```bash
docker compose up -d
```
**Expect:** a `lcc_eportal_dev` Postgres container running on `localhost:54329`. Check with
`docker compose ps` — status should be "Up" or "healthy".
**If it fails:** port 54329 already in use — stop whatever's using it, or change the port in both
`docker-compose.yml` and `.env.local`'s `DATABASE_URL` consistently.

## 5. Run migrations

```bash
npm run db:migrate
```
**Expect:** ends with "Migrations applied." A couple of harmless NOTICE lines about "schema already exists,
skipping" on a re-run are normal, not errors.
**If it fails:** a real error here (not a NOTICE) means a migration conflict — do not hand-edit a migration
file; stop and investigate which migration failed and why before proceeding.

## 6. Seed reference data and bootstrap a Super Admin

```bash
npm run db:seed
```
**Expect:** ends with "Seed complete." Safe to re-run any time.

Then, **only if this is a fresh database with no Super Admin yet**:
```bash
npx tsx src/lib/db/bootstrap.ts <your-username> "Your Display Name"
```
**Expect:** prints a temporary password once. Save it now — it is never shown again and never stored in
plaintext. This creates a REAL Supabase Auth user, so it needs the real Supabase env vars from step 3.

For running the test suite (not for real use), you can instead run:
```bash
npm run test:fixtures
```
**Expect:** "Creating test-fixture Super Admin app_user row (...)" or "An active Super Admin already exists."
This one does NOT need real Supabase — it's a synthetic fixture for the test suite only (see the comment in
`src/lib/db/testFixtures.ts` for why that's safe).

## 7. Lint

```bash
npm run lint
```
**Expect:** no output beyond the command header — zero errors, zero warnings (this was true as of the last
commit in this session).
**If it fails:** run `npm run lint -- --fix` for auto-fixable issues, then re-check manually.

## 8. Typecheck

```bash
npm run typecheck
```
**Expect:** "Generating route types... ✓ Types generated successfully" — no error output from `tsc`.
**If it fails:** read the file:line TypeScript points at; this codebase has zero tolerance for `any` or
type errors, so don't suppress with `// @ts-ignore` — fix the actual type mismatch.

## 9. Run the full test suite — THE PART THIS SESSION COULD NOT DO

```bash
npm run test
```
This needs your **real** Supabase project's `SUPABASE_SERVICE_ROLE_KEY` (step 3) — it creates and deletes
real Auth users as part of 9 of the 20 test files. This session only had a placeholder project, so **these
9 files have never actually been run against real Auth, ever, for this entire codebase's history**:
`academic/calendar`, `academic/structure`, `gpa/recompute`, `grades`, `historical`, `identity/accounts`,
`offerings`, `planning`, `students` (all `*.integration.test.ts`).
**Expect:** "Test Files 20 passed (20)" or similar — all files, not the `test:ci` subset.
**If it fails:** this is the single most important signal from this whole checklist — a failure here means
something in Stage 3 onward has never actually been validated against real Supabase Auth behavior. Read the
failure carefully; it is likely a real, previously-undetected defect, not a flake.

## 10. Run the reconciliation checks

```bash
npm run db:reconcile
```
**Expect:** all three checks report "OK" and "Reconciliation PASSED." This session ran it against an empty
database (0 students) and got a clean pass — re-run it after step 9 populates real test data, and again
against production data periodically per `docs/BACKUP_RESTORE_RUNBOOK.md`.

## 11. Production build

```bash
npm run build
```
**Expect:** every route in the printed table shows `ƒ` (dynamic) except `/` and `/_not-found` (static), and
"ƒ Proxy (Middleware)" appears near the bottom. This session verified this exact output.
**If it fails:** if it's the Supabase-env-check crash described in `DECISIONS.md` DEV-13, confirm step 3's
env vars are actually set in the shell/CI environment running the build, not just in `.env.local` (some CI
systems don't read that file automatically).

## 12. Playwright / e2e tests — ALSO NOT RUN THIS SESSION

```bash
npx playwright install   # first time only, downloads real browsers
npm run test:e2e
```
This needs the real Supabase project too (same reason as step 9) plus a running app (`playwright.config.ts`
starts `npm run dev` automatically). **7 spec files, including the new `admin-grades.spec.ts` and the
extended `auth.spec.ts`, have never been run against a real browser and real Auth.**
**Expect:** all specs pass. `admin-grades.spec.ts` specifically verifies the full grade lifecycle (Admin
enters/submits, Super Admin approves, grade publishes) — a genuine failure here means either a real defect
or (more likely, since it's new) a selector/copy mismatch in the test itself that needs a small fix, not
necessarily an app bug. `auth.spec.ts`'s bypass test specifically verifies this session's `src/proxy.ts`
security fix actually works end-to-end — this is the most important one to watch.
**If it fails:** re-run with `npx playwright test --debug <file>` to step through interactively and see
exactly where it diverges from what the test expects.

## 13. Supabase configuration you need to provide/confirm

- Real project URL + keys (step 3) — **required**, not optional, for steps 9 and 12.
- Confirm the pooler connection string is used in **transaction mode** for `DATABASE_URL` when pointing at
  Supabase directly (not the Docker Postgres).
- Decide on DEC-31 (paid tier with PITR) and DEV-09 (backup) — see `docs/BACKUP_RESTORE_RUNBOOK.md`. This
  is a cost/timeline decision, not something to configure blindly.

## 14. GitHub/CI steps you need to perform

- Fix the Claude GitHub App installation for `231AG` (prerequisites, above) so this session's work can push.
- Decide whether to add a second, dedicated Supabase project for CI (declined once already per DEV-12/DEV-9
  — revisit if the 9 excluded test files and e2e specs turn out to matter enough to automate).
- No GitHub Actions secrets need to be added for the *current* `ci.yml` — it deliberately doesn't touch real
  Supabase. If you do add a CI test project later, you'd add its URL/keys as repo secrets and update
  `ci.yml`'s `env:` block and remove the `--exclude` flags from `test:ci`.

## 15. Backup/restore testing — MUST be performed, cannot be simulated

Follow `docs/BACKUP_RESTORE_RUNBOOK.md` in full once the Supabase tier is upgraded: enable PITR, then
**actually restore a backup into a scratch project** and verify record counts and CGPA samples match. A
backup that has never been restored is not a working backup — this is not optional busywork, it's the
plan's own explicit Go-Live gate condition.

## 16-17. Commands, in order, for a full from-scratch verification

```bash
git checkout stage/11-hardening-go-live && git pull
npm ci
cp .env.example .env.local        # then edit in real Supabase values
docker compose up -d
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm run test                       # needs real Supabase -- see step 9
npm run db:reconcile
npm run build
npx playwright install
npm run test:e2e                   # needs real Supabase -- see step 12
```

## 18. Expected output, quick reference

| Command | Success looks like |
|---|---|
| `npm run db:migrate` | "Migrations applied." |
| `npm run db:seed` | "Seed complete." |
| `npm run lint` | No output, no errors |
| `npm run typecheck` | "Types generated successfully" |
| `npm run test` | "Test Files 20 passed (20)" |
| `npm run db:reconcile` | "Reconciliation PASSED." |
| `npm run build` | Route table with mostly `ƒ`, "ƒ Proxy (Middleware)" present |
| `npm run test:e2e` | All specs pass |

## 19. If a command fails

1. Read the actual error, not just "it failed" — most of the errors you'll hit are already explained in
   `docs/INCIDENT_RUNBOOK.md`.
2. Don't work around a failure by disabling a check, skipping a test, or editing data directly in the
   Supabase dashboard — that's explicitly the kind of shortcut this whole build was designed to prevent.
3. If it's one of the 9 previously-never-run test files or an e2e spec failing for the first time: treat it
   as a real finding worth investigating, not an assumed flake — nothing has validated that code path
   against real Auth before.

## 20. Go/no-go for UAT / pilot / production

**Go** (safe to start a supervised pilot with real staff, not yet real irreplaceable student data):
- [ ] Steps 1-11 above all pass
- [ ] `npm run test` (full suite, step 9) passes against real Supabase
- [ ] `npm run test:e2e` (step 12) passes, especially `auth.spec.ts`'s bypass regression test
- [ ] You've read `AS_BUILT.md` and `SECURITY_REVIEW.md` in full

**No-go for anything with real, irreplaceable student data** until, additionally:
- [ ] A real backup exists and **a real restore has been rehearsed and verified** (`docs/BACKUP_RESTORE_RUNBOOK.md`) — this is the single biggest gap
- [ ] UAT has been run with actual Admin office staff and real (or realistic) paper records, and signed off
- [ ] DEC-12 (prerequisite override date) and DEC-26 (conflict adjudicator) have real answers from the
  Registrar's office
- [ ] You've made a decision on DEV-14 (the DER-25 performance budget question) — informational only, not a
  blocker either way

Until every box in the second list is checked, this system is a pilot, not the plan's Go-Live — say so
plainly if anyone asks.
