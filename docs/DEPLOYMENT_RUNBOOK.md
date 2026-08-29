# Deployment Runbook

Deploy target assumed: Vercel (Next.js's own platform) for the app, Supabase for Postgres + Auth — the
stack the plan specifies. Adjust if deploying elsewhere; the steps that matter (migrations before traffic,
env vars, bootstrap) are the same regardless of host.

**Current state (per DECISIONS.md DEV-01/DEV-09): there is one Supabase project, used for development and
as the production target — not the three separate environments the plan calls for, and it has no backup
configured.** This runbook deploys into that reality as it actually is. Do not describe this as a
fully-isolated production deployment until DEC-31/DEV-09 are revisited.

## One-time: Supabase project

1. In the Supabase dashboard, note the project's connection string (**use the pooler, transaction mode** —
   Section 8's own requirement, and what `DATABASE_URL` must point at) and the API keys under
   Project Settings → API.
2. Confirm the project's Postgres extensions/schemas are default (no manual schema changes ever go through
   the dashboard — migrations only, per `docs/SETUP.md`).

## One-time: environment variables

Set these in Vercel's project settings (or your host's equivalent), not in a committed file:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase pooler connection string, transaction mode | Server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Safe for the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key | **Server-only. Never `NEXT_PUBLIC_*`-prefixed. Never logged.** |
| `INSTITUTION_TIMEZONE` | `Africa/Monrovia` | Display only; data stored UTC |
| `NODE_ENV` | `production` | Set automatically by most hosts; confirms this to the session-cookie `Secure` flag logic in `src/lib/supabase/cookieOptions.ts` |

## Every deploy: migrations before traffic

Migrations must be applied **before** the new app version receives any traffic — a forward-only,
checked-in-SQL migration pipeline (per `docs/SETUP.md`) with no rollback story beyond a new forward
migration.

```bash
# From CI or a deploy hook, pointed at the production DATABASE_URL:
npm run db:migrate
npm run db:seed        # idempotent -- safe to run every deploy
```

Then deploy the app build itself (`npm run build` / your host's normal build step).

## First deploy only: bootstrap the first Super Admin

Nothing in the running application can create the first Super Admin — it's a deliberate gap the plan
documents (DER-26). Run once, from a machine with the production `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` set:

```bash
npx tsx src/lib/db/bootstrap.ts <username> <display name>
# e.g. npx tsx src/lib/db/bootstrap.ts vpaa.admin "VPAA Office"
```

This prints a temporary password **once**, to your terminal, never stored anywhere in plaintext. Hand it to
that person in person or on paper, and have them log in and change it immediately — the account is already
flagged to force that.

## Verifying a deploy

1. `curl https://<your-domain>/api/health` → expect `{"status":"ok","database":"reachable",...}`.
2. Log in as the bootstrap Super Admin, confirm the forced password-change screen appears and can't be
   bypassed by navigating elsewhere directly (this is `src/proxy.ts` — see `SECURITY_REVIEW.md`).
3. Run `npm run db:reconcile` against the production `DATABASE_URL` — expect all three checks to report
   zero mismatches on a fresh deploy with no data yet.

## Rolling back

There is no automatic rollback of a bad migration. If a deploy introduces a schema problem: write and apply
a new forward migration that corrects it (never edit or delete an already-applied migration file), then
redeploy the app. If the *application code* (not the schema) is the problem, redeploying the previous build
against the same, already-migrated database is normally safe — check the specific migration for anything
that would make the previous code incompatible with the new schema before doing this.

## What this runbook does not cover

**Backup and restore.** See `docs/BACKUP_RESTORE_RUNBOOK.md` — as of this writing, there is no backup
configured at all (DEV-09). Do not treat a successful deploy as evidence the system is safe to hold real
student data; those are two different questions.
