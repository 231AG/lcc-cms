# Incident Runbook

For "something is wrong in production" situations. For the specific case of data loss/corruption, see
`docs/BACKUP_RESTORE_RUNBOOK.md` first — as of this writing there is no working backup, which changes what's
actually possible.

## First: is the app even reachable?

```bash
curl https://<your-domain>/api/health
```
- `{"status":"ok",...}` → the app and database are both reachable. The problem is more specific than
  "everything is down" — narrow it with the sections below.
- `{"status":"error","database":"unreachable"}` (HTTP 503) → the app is running but can't reach Postgres.
  Check the Supabase project's own status page/dashboard first (an outage on their end is more likely than
  a config change on yours).
- No response at all / connection refused → the app itself isn't running. Check your host's (Vercel's)
  deployment status and logs.

## "A user can't log in"

1. Confirm it's not a forced-password-change loop working as intended: `src/proxy.ts` redirects **every**
   route to `/change-password` for an account with `must_change_password = true`, by design — check the
   user's `app_user.must_change_password` value before assuming it's a bug.
2. Confirm the account is `status = 'ACTIVE'`, not `'DISABLED'`.
3. Login failures (wrong password/Student ID) show a deliberately generic message and are logged as
   `LOGIN_FAILED` in the audit log with the attempted identifier — check there for a pattern (e.g. someone
   using the wrong username format) before assuming an account-level problem.

## "A grade/record looks wrong"

Never edit data directly in the Supabase dashboard's table editor — that bypasses every check constraint,
RLS policy, and audit entry this system relies on, and is explicitly the kind of drift the plan warns
against. Instead:

1. Check `/admin/audit` filtered by that student's id — every change to their record has an old/new value
   and an actor.
2. If a **published/locked** grade is genuinely wrong, the only lawful fix is the correction workflow
   (`/admin/grade-corrections`) — an Admin requests, a different Super Admin decides. This exists precisely
   so a wrong grade is never fixed by a single person outside the audit trail.
3. Run `npm run db:reconcile` — if a student's summary looks inconsistent with their individual records,
   this will catch and (for the summary checks specifically) self-heal drift between
   `student_semester_summary`/`student_cumulative_summary` and the GPA engine's own recomputation.

## "The semester export looks incomplete"

Check whether the semester still has ungraded classes — `/admin/export` shows a warning per semester when
registered students still have no published grade. The export is deliberately incomplete in that case, not
broken; publish the outstanding grades first.

## "CI is failing" / "tests won't pass"

Before assuming a real regression: check whether the failing test is one of the 9 files excluded from CI by
design (`DECISIONS.md` DEV-12 — they need a real Supabase project CI doesn't have). Those must be run
locally (`npm run test`, not `npm run test:ci`) against a real Supabase project. A failure in one of the 11
CI-covered files, or in `lint`/`typecheck`/`build`, is a real signal.

## "The build is failing on Vercel/CI but works locally"

Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are actually set in that
environment — `next build`'s static-generation pass needs *some* value for these (they don't need to
resolve to a real project during the build itself) or every authenticated page's build step fails outright.
See `DECISIONS.md` DEV-13 for the full explanation.

## Escalation

For anything not covered above, or a genuine data-loss event: stop, do not attempt a manual database fix,
and follow `docs/BACKUP_RESTORE_RUNBOOK.md`'s "if data loss actually happens" section. Record what you
observed and when in the audit log's surrounding context (screenshots, timestamps) before taking any action
that might change the state further.
