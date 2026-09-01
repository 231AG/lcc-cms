# Security Review — Stage 11

Per DECISIONS.md DEV-10, this is an internal code-level self-review against every control in the plan's
`Section 18: Security Architecture`, not a third-party audit or penetration test (the plan itself lists a
formal pentest as a FUTURE/Phase-2 item, not a Phase 1 requirement). Performed 29 Aug 2026, against
`stage/11-hardening-go-live`. Every finding below was verified against the actual code or a real running
build — nothing here is asserted from memory of the design.

## REQUIRED controls (Phase 1 cannot ship without these)

| Control | Status | Evidence |
|---|---|---|
| Managed password hashing | **Pass** | Delegated entirely to Supabase Auth (`supabase.auth.admin.createUser`, `updateUser`). No app code reads, stores, or hashes a password anywhere. |
| Forced first-login password change, unbypassable by direct URL | **Was failing — fixed** | The redirect existed on only 2 of 21 routes (`/portal`, `/planning`); every other page (accounts, structure, calendar, offerings, students, grades, grade-review, grade-corrections, historical, registrations, export, audit, grading-policy) had no check at all. Fixed centrally in `src/proxy.ts`, verified against a real build/server. |
| Server-side authorization on every mutation | **Pass** | Every write path in `src/lib/*` calls `assertCan(actor, action)` before touching data — the single permission-kernel gate (`src/lib/permissions/kernel.ts`), deny-by-default on a missing row. |
| Row-Level Security on every table | **Pass** | Every `app.*` and `audit.*` table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` with explicit policies, added in the same migration that creates the table (see `drizzle/000*_*_constraints_rls.sql`). |
| Student data isolation | **Pass** | RLS scopes student-facing SELECT policies to `auth.uid()` (e.g. `grade_record_select_own_published`, `academic_record` policy). Every caller of a by-id lookup (`getStudent`, etc.) for a STUDENT actor passes `actor.userId` itself, never a client-supplied id — confirmed by checking every call site. Covered by `src/lib/db/__tests__/identity_rls.integration.test.ts` ("authenticate as student A, request student B's record, assert refusal"). |
| Segregation of duties | **Pass** | `reviewedBy != submittedBy` and `decidedBy != enteredBy`/`requestedBy` are DB `CHECK` constraints on `grade_submission`, `grade_record`, `grade_correction_request` — enforced even if the service layer had a defect — plus the same check duplicated in `grades.ts`'s service code. |
| Input validation server-side; parameterised queries only | **Pass** | Every `sql\`...\`` occurrence in the codebase uses Drizzle's tagged-template parameter binding (`${value}` is bound, not concatenated) — checked every occurrence, including the recursive-CTE cycle-detection query in `structure.ts`. No string-built SQL anywhere. |
| Transport security (HTTPS, HSTS, secure cookies) | **Pass — confirmed live, 1 Sep 2026** | Session cookie `Secure` flag conditioned on `NODE_ENV=production`; confirmed `true` on the live deployment. HTTPS and HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) both confirmed present via direct inspection of `https://lcc-cms.vercel.app` — Vercel provides both automatically, no app-level config needed. |
| Secrets management | **Pass** | `.env.local` is gitignored; no secret ever appears in the repo. `SUPABASE_SERVICE_ROLE_KEY` is never `NEXT_PUBLIC_*`-prefixed; confirmed absent from the actual compiled client bundle (`grep`'d shipped `.next/static/chunks/*.js` for `supabase`/`postgres`/`drizzle`/`SERVICE_ROLE` — zero matches). No `.tsx` file imports `createAdminClient`. |
| Append-only audit | **Pass** | `authenticated` has `INSERT`-only privilege on `audit.audit_log` (`0001_audit_privileges.sql`) — no `UPDATE`/`DELETE` grant exists for any application role. |

## Fixes made during this review

1. **`src/proxy.ts` (new)** — closes the forced-password-change bypass above. Next.js 16 renamed
   `middleware` to `proxy`; it now defaults to the Node.js runtime, which is what makes a real DB-backed
   check possible here (Edge runtime could not have queried Postgres directly).
2. **Security response headers** — added to the same proxy: `Content-Security-Policy` (`script-src 'self'`;
   `style-src 'self' 'unsafe-inline'` — see the code comment for why this isn't nonce-based),
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `X-Frame-Options: DENY`.
3. **Session cookie flags** — `src/lib/supabase/cookieOptions.ts` (shared by `server.ts` and `proxy.ts`):
   `@supabase/ssr`'s own default is `httpOnly: false` with a 400-day `maxAge`; neither had ever been
   overridden. Now `httpOnly: true`, `secure` in production, `sameSite: 'lax'`, `maxAge` shortened to 12
   hours. The app has no client-side Supabase usage anywhere, so `httpOnly` costs nothing functionally.
4. **Password policy** — added a small blocklist of obvious/keyboard-walk passwords on top of the existing
   10-character minimum (`src/app/change-password/actions.ts`).

## RECOMMENDED controls

| Control | Status | Notes |
|---|---|---|
| Rate limiting on authentication | **Not implemented** | A real distributed limiter needs an external store (Redis/Upstash) not currently part of this stack. Not added speculatively; flagged as a genuine gap for the project owner to prioritize, not silently skipped. |
| Password policy | **Pass** (see above) | |
| Session lifetime / idle timeout, shorter for staff | **Partial** | Uniform 12-hour cookie `maxAge` added (down from 400 days). Not role-differentiated (shorter for Admin/Super Admin than Student, as the plan suggests) — Supabase's actual token expiry is a per-project dashboard setting, not app code; role-based enforcement would need additional logic (compare token issued-at against a role-keyed threshold) not built in this pass. |
| Security headers | **Pass** (see above) | |
| Safe error handling | **Partial** | Every mutating path throws a typed `AppError` subclass and callers show its `.message`, never a raw stack/SQL/record dump. `AppError.correlationId` is declared but **never populated anywhere in the codebase** — an unexpected error shows a clear message but no correlation id an Admin could cross-reference against the audit log. Not fixed this pass: doing it properly needs a request-scoped id generator wired through every action/route, which is closer to an observability-infrastructure decision than a quick patch. |
| Log hygiene | **Pass** | Every `console.log`/`console.error` in the codebase is confined to one-time CLI scripts (`migrate.ts`, `seed.ts`, `bootstrap.ts`, `testFixtures.ts`, `reconcile.ts`) — none in the request-handling path. `bootstrap.ts` prints a temporary password once to the operator's own terminal, which is the documented one-time procedure (DER-26), not a persistent application log. |
| Dependency management | **4 moderate findings — not auto-fixed, see below** | |

### Dependency sweep detail

`npm audit` reports 4 moderate-severity findings, all one transitive chain: `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → a vulnerable `esbuild` (`GHSA-67mh-4wv8-2f99`, "esbuild's dev server accepts requests from any website"). Checked directly against the npm registry: **the latest published `drizzle-kit` (`0.31.10`) — already what this project has installed — still depends on the same vulnerable `esbuild` range.** There is no newer, non-breaking version that fixes this yet. `npm audit fix --force` would downgrade `drizzle-kit` to `0.18.1`, a major-version regression with a different config format that would very likely break this project's 20 existing migrations — a materially worse outcome than the finding itself.

Risk assessment: `drizzle-kit` is a **dev-only** dependency (schema generation and migration authoring, run by a developer on their own machine) — it is never installed in production (`npm ci` in `ci.yml` installs it because `package.json` doesn't separate prod/dev installs in that step, but nothing in the deployed app imports or executes it at runtime), and the vulnerability itself only matters if someone runs esbuild's own development server exposed to an untrusted network, which this project never does. **Accepted as a known, low-risk, currently-unfixable-without-regression finding** — not silently ignored. Re-check `npm outdated drizzle-kit` periodically; take the upstream fix once one ships.

## Deferred / out of scope for this review

- **Multi-factor authentication for Super Admin**, **IP allow-listing**, **self-service password reset**,
  **field-level encryption**, **formal penetration test** — all explicitly listed in the plan itself as
  FUTURE/Phase-2 items, not Phase 1 requirements. Not attempted.
- ~~A live, authenticated-session test of the proxy's redirect~~ — **done, 31 Aug 2026** against local dev
  Supabase, and **done again, 1 Sep 2026, against the actual production deployment**
  (`https://lcc-cms.vercel.app`) once it was live: a real Playwright browser session logged in, confirmed the
  forced-password-change redirect can't be bypassed by direct navigation to `/portal`, `/admin/accounts`, or
  `/admin/audit`, and inspected the real `Set-Cookie` flags on the live site: `sb-*-auth-token` came back
  `httpOnly=true secure=true sameSite=Lax` — exactly matching `src/lib/supabase/cookieOptions.ts`'s intent,
  now confirmed on real HTTPS rather than inferred from local dev (where `secure` can't actually be
  observed true, since `next dev` serves plain HTTP). Also confirmed Vercel adds `Strict-Transport-Security`
  automatically at the platform level — the one §18 transport-security item this document had marked
  "hosting-layer, can't verify from inside this codebase" is now directly confirmed active.
