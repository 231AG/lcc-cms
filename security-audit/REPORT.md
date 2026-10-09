# LCC E-Portal — Security audit and bug hunt: REPORT

Scope: this repository, tested black-box against a **production build running only on this machine** (local Postgres 16 built from the repo's own migrations, local GoTrue, throw-away keys, no `.env.local`, no production URL or data — every test script refuses non-loopback targets).
Status of the app code: **unchanged**. `git status` shows only the new `security-audit/` folder. No fixes have been made; none will be until you approve (Phase 4).
Baseline (Phase 0, before any testing): typecheck, lint, build and the full test suite were green — see `00-system-map.md` and `data/baseline-*.txt`.

How to read the verdicts: **CONFIRMED** = I reproduced it (test file named). **SUSPECTED** = follows from code/config but depends on something I cannot see from here (your hosted Supabase/Vercel settings); the manual check is listed in section 5.

---

## 1. Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 3 | SEC-01, SEC-02 (dependency), BUG-01 |
| Medium | 6 | SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, BUG-02 |
| Low | 7 | SEC-08, SEC-09, SEC-10, BUG-03, BUG-04, BUG-05, BUG-06 |
| Info | 5 | INFO-01 … INFO-05 |

Nothing I found lets an outsider read or change student records. The weak spots are: **no brute-force protection on login**, **sessions that are meant to last 12 h/1 h idle but actually last 400 days and can skip the idle check**, **a Next.js security patch you have not applied**, and a handful of **functional bugs that crash screens** (photo uploads between 1–2 MB, a mistyped grade crashing the whole class save).

---

## 2. Findings — CONFIRMED (reproduced)

### SEC-01 — No limit on login attempts (brute force)
- **Severity:** High
- **Location:** `src/app/login/actions.ts:15-38` (`loginAction`); same exposure on the "current password" check in `src/app/(portal)/change-password/actions.ts` (it calls `signInWithPassword`).
- **Problem:** The app counts nothing and locks nothing. Student IDs are guessable (7 digits, year prefix) and the student password rule is only 6 characters with one digit and one lowercase letter.
- **Proof:** `tests/01-auth.mjs` A1 — 60 wrong passwords for one account in 4.9 s, zero throttled, then the correct password still logged in. Log: `tests/results/01-auth.log`.
- **Impact:** Anyone who can reach the login page can guess passwords for any student at machine speed. Hosted Supabase Auth has its own per-IP limit, but (a) it is not per account, (b) it cannot be seen from here, and (c) because the *server* calls Supabase, every user's login comes from the same Vercel IP, so the limit may be shared — an attacker could use it to block everyone (SUSPECTED, see section 5).
- **Fix (minimal):** Count failed attempts per login identifier (and per IP) in a small table; after ~8 failures in 15 minutes answer every attempt with the same generic "try again later" (delay rather than permanent lock, so an attacker cannot lock a student out for good). Also turn on CAPTCHA/rate limits in the Supabase dashboard (section 5).
- **Risk of fix:** M (must not lock out real students; needs the same generic response so it doesn't reveal which IDs exist). **Effort:** M. **Needs:** new migration (attempt table) + rollback SQL.

### SEC-02 — Next.js 16.3.5 has a published critical advisory (and two high ones in dependencies)
- **Severity:** High (rating of the advisory); **real exposure here: low**, because the vulnerable feature (`next/og` `ImageResponse`) is not used anywhere in `src/` (grep: no `next/og`, no `opengraph-image`/`icon` routes).
- **Location:** `package.json` → `next` 16.3.5; `sharp` 0.35.4 (high, GHSA-wq5f-xc86-pv6w, fixed 0.35.5); `source-map-js` (high DoS, GHSA-68fv-2mgg-jv7q, fixed 1.2.2). Next: GHSA-vcvr-r3jv-pc5j, affected `>=16.2.0 <16.3.6`.
- **Proof:** `npm audit --omit=dev` → 3 production findings (1 critical, 2 high); `data/` has the JSON. The 10 other findings are dev-tooling only (drizzle-kit/esbuild, eslint-config-next chain) and do not ship.
- **Impact:** Not reachable through today's code, but anything that later adds an image route would be. Staying on a version with a critical advisory also fails any future review.
- **Fix:** Patch update within the same minor: `next` → 16.3.8 (latest 16.3.x), `npm audit fix` for `sharp` and `source-map-js`. **Not** the 16.4 minor and **not** `npm audit fix --force` (it wants to *downgrade* eslint-config-next / drizzle-kit — rejected).
- **Risk of fix:** L–M (Next's own docs in `node_modules/next/dist/docs/` must be re-checked for the patch; run the full baseline). **Effort:** S. **Needs:** your approval to change dependencies.

### SEC-03 — Sessions last 400 days, not the intended 12 hours
- **Severity:** Medium
- **Location:** `src/lib/supabase/cookieOptions.ts:38` (`maxAge: 12 * 60 * 60`) is applied in `src/lib/supabase/server.ts:46` and `src/proxy.ts:181`, **but** `@supabase/ssr` 0.12.5 overwrites it: `node_modules/@supabase/ssr/dist/main/cookies.js:233,464` hard-codes `maxAge: DEFAULT_COOKIE_OPTIONS.maxAge` (400 days) on every auth-cookie write.
- **Proof:** `tests/01-auth.mjs` A5a — login response sets the session cookie with `Max-Age=34560000` (400 days), `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Impact:** A copied or stolen cookie (shared computer, malware, proxy log) stays useful far longer than anyone intends; the code's own comment says 12 h was the design.
- **Fix:** In both `setAll` callbacks (`server.ts`, `proxy.ts`) force `maxAge` to the 12 h value for the `sb-*-auth-token*` cookies after the library's options are applied. Add a test that reads the real `Set-Cookie`.
- **Risk of fix:** L–M (everyone is asked to log in again after 12 h; refresh-token rotation unaffected). **Effort:** S. **Needs:** nothing in the DB. Users are logged out once when it ships.

### SEC-04 — The 1-hour idle timeout can be skipped by dropping one cookie
- **Severity:** Medium
- **Location:** `src/proxy.ts:209-210` — `lastActivity !== null && isIdle(...)`: a request with a valid session but **no** `lcc-last-active` cookie is treated as "not idle" and then gets a fresh cookie.
- **Proof:** `tests/02-session.mjs` A7b — session cookie alone → 200 and the portal is served. (A7a: a stale activity cookie *is* correctly rejected, so the rule only binds clients that choose to send the cookie.)
- **Impact:** Anyone holding a stolen session cookie bypasses the idle rule simply by not sending the second cookie. Combined with SEC-03 this is a long-lived session.
- **Fix:** Make the login action set the activity cookie, then treat "signed in but no activity cookie" as idle in the proxy.
- **Risk of fix:** M (the first request after login must already carry the cookie; test the login → forced-change → portal paths). **Effort:** S–M.

### SEC-05 — Audit log can be forged by any signed-in database user
- **Severity:** Medium if the `audit` schema is reachable through Supabase's API (SUSPECTED), Info otherwise; the database fact is CONFIRMED.
- **Location:** policy `audit_log_insert_any_authenticated` — `drizzle/0001_audit_privileges.sql`: `FOR INSERT TO authenticated, service_role WITH CHECK (true)`. Table `audit.audit_log`.
- **Proof:** local DB as `authenticated` with a student's id: `INSERT INTO audit.audit_log (actor_user_id, actor_role_snapshot, action, …) VALUES (<student>, 'SUPER_ADMIN', 'grade.approve', …)` → `INSERT 0 1` (rolled back). Reads, updates and deletes are correctly refused (`permission denied`). Output in `tests/results/05-rls-counts.txt`; commands in this report's section 6.
- **Impact:** If a student can reach the database role `authenticated` directly (PostgREST with `audit` exposed, or a leaked connection), they can write entries claiming to be an admin approving grades. Normal app use cannot.
- **Fix:** New migration: replace the policy with `WITH CHECK (actor_user_id = auth.uid())` (the app writes audit rows from `asUser()` transactions — about 100 call sites — so a blanket "service role only" policy would break it). Rollback SQL goes in `rollbacks/`.
- **Risk of fix:** M (rows with a NULL actor written through `asUser` would be refused — run the full integration suite). **Effort:** S. **Needs:** DB migration.

### SEC-06 — Disabling an account does not disable its Supabase login
- **Severity:** Medium (defence in depth)
- **Location:** `src/lib/identity/accounts.ts:91-118` (`disableAccount` only sets `app_user.status`); `drizzle/0003_identity_constraints_rls.sql:112` (`app.current_user_role()` ignores `status`).
- **Proof:** `tests/07-disable.mjs` — B4 PASS: an open session of a disabled admin is cut off at once and their action did nothing. B5 FAIL: Supabase Auth still issues a fresh token to the disabled user (HTTP 200). B6 PASS: the disable is audit-logged.
- **Impact:** The application blocks the user on every request, so today they get nowhere. But the database-level rules still treat a disabled ADMIN as an ADMIN, and the Supabase token is valid — if the Supabase API is ever exposed (section 5) a "disabled" admin could still write catalogue data.
- **Fix:** (1) `disableAccount` also bans the Auth user / signs them out globally via the admin API; `enableAccount` lifts it. (2) New migration: `app.current_user_role()` returns NULL unless `status = 'ACTIVE'`.
- **Risk of fix:** M (a function used by ~40 policies; (2) needs the full suite plus a rollback). **Effort:** M.

### SEC-07 — Nothing records logins or failed logins
- **Severity:** Medium (detection gap; makes SEC-01 invisible)
- **Location:** `src/app/login/actions.ts`; `app_user.last_login_at` exists (`src/lib/db/schema/identity.ts:23`) but is never written.
- **Proof:** grep: no writer for `lastLoginAt`; local audit log contains no login/failed-login action types; `last_login_at` is NULL for 220/220 users.
- **Impact:** A password-guessing campaign or a compromised account leaves no trace in the portal; the Registrar cannot see "last login".
- **Fix:** Write `LOGIN_SUCCEEDED` (and set `last_login_at`) and a rate-limited `LOGIN_FAILED` audit event. Can share the table from SEC-01.
- **Risk of fix:** L. **Effort:** S.

### SEC-08 — Login timing reveals which student IDs exist
- **Severity:** Low
- **Location:** `src/app/login/actions.ts:23-38` — a malformed or unknown ID returns in ~10 ms, a real ID with a wrong password in ~85 ms.
- **Proof:** `tests/01-auth.mjs` A2a (identical responses: PASS) and A2b (timing: FAIL; local GoTrue, hosted numbers will differ but the shape will not).
- **Fix:** Equalise (dummy credential check or a fixed minimum response time). **Risk:** L. **Effort:** S.

### SEC-09 — Unauthenticated visitors get the page shell instead of a redirect
- **Severity:** Low (no data leaked — verified)
- **Location:** `src/proxy.ts:203` (`if (!userId) return …` lets the request through; each page gates itself).
- **Proof:** `tests/06-routes-idor.mjs`: anonymous `GET /portal`, `/admin/students`, `/admin/accounts`, `/admin/audit` → 200 with the text "Please sign in." and no records (checked for known names). Only `/` and `/change-password` redirect.
- **Impact:** Today safe. It relies on every present *and future* page remembering to check — the single place that could cover them all (the proxy) doesn't.
- **Fix:** Redirect unauthenticated requests to `/login` in the proxy (except `/login`, `/access-denied`, static assets). **Risk:** L–M (cannot break signed-in use; check login → redirect loops). **Effort:** S.

### SEC-10 — Minor header hygiene
- **Severity:** Low
- **Location:** `next.config.ts` (empty); `src/proxy.ts` CSP `style-src 'self' 'unsafe-inline'`; `/api/health` is excluded from the proxy so has no security headers.
- **Proof:** `curl -I` in section 6: `X-Powered-By: Next.js` present on pages; no HSTS/XFO/nosniff on `/api/health`.
- **Fix:** `poweredByHeader: false`. The inline-style allowance and the health route are accepted (React inline styles; health returns `{status}` only). **Risk:** L. **Effort:** S.

### BUG-01 — Photo uploads of 1–2 MB and imports over 1 MB crash
- **Severity:** High (functional; breaks a core admin task)
- **Location:** `next.config.ts` has no `serverActions.bodySizeLimit`; Next's default is 1 MB (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`). The app's own photo cap is 2 MB (`src/lib/students/imageFormat.ts`), and the past-grades / course import screens send whole files as one action argument.
- **Proof:** `tests/08-limits.mjs` — 60×60 photo: OK; 1.5 MB PNG (under the app's 2 MB cap): HTTP 500 "Internal Server Error"; grade-sheet import preview with 900 KB: OK, with 1.1 MB and 3 MB: 500.
- **Impact:** Registrar uploads a normal phone photo and gets a blank error page; a long past-grades sheet cannot be imported at all.
- **Fix:** In `next.config.ts`, per the bundled Next docs: `serverActions: { bodySizeLimit: '3mb' }` (or the size you want to allow), and make the photo/import screens show the friendly message for the over-limit case. **Risk:** L. **Effort:** S.

### BUG-02 — One mistyped grade crashes the whole class save and loses every score
- **Severity:** Medium
- **Location:** `src/app/(portal)/admin/grades/actions.ts:32` (`Number(scoreRaw)`), same in `grade-corrections/actions.ts:20`, `student-grades/actions.ts:38`; `src/lib/gpa/engine.ts:108` (`OutOfRangeScoreError extends Error`, not `AppError`) so the action's `catch` re-throws it.
- **Proof:** `tests/10-grades.mjs` — scores `abc`, `101`, `-1`, `NaN`, `1e3`, `Infinity`, `59,5` → HTTP 500 for the whole save. `0x10` is silently **accepted as 16** (JavaScript `Number()` reads hex/binary/exponent forms), so `1e1` would be stored as 10.
- **Impact:** A lecturer entering a class of 40 scores who types 101 for one student gets the error screen and has to retype everything. Accepting `0x10`/`1e1` stores a wrong grade without any warning.
- **Fix:** Strict parse (`^\d{1,3}(\.\d)?$`, one decimal — which also fixes BUG-03), and map `OutOfRangeScoreError` to a `ValidationError` naming the student/row. **Risk:** L. **Effort:** S.

### BUG-03 — Stored score and letter can disagree by a rounding step
- **Severity:** Low (letter and GPA are correct; only the displayed number differs)
- **Location:** `src/lib/grades/grades.ts:293` (`roundHalfUp(score, 1)`) then `:482` (`Math.round(Number(g.score))`) — the score is rounded twice; the letter is derived from the raw value rounded once (`engine.ts:119`).
- **Proof:** `tests/helpers/gpa-edges.ts` → `tests/results/09-gpa-edges.txt`: 59.46 → letter **F** but academic-record score **60**; 94.45 → **A-** but score **95**. All other edges match: 59 F, 59.4 F, 59.5 D-, 60 D-, 94.4 A-, 94.5 A+, 100 A+, out-of-range refused.
- **Fix:** Restricting input to one decimal (BUG-02) makes the first rounding exact, so the second agrees. No migration. **Risk:** L. **Effort:** S.

### BUG-04 — Empty or malformed ids in a request become a raw database error (500)
- **Severity:** Low (needs a hand-crafted request; the UI always sends valid ids)
- **Location:** services reading an id from form fields without validating it — hit in `tests/03-authz.mjs`: `clearDraftGradeAction`, `requestCorrectionAction`, `decideCorrectionAction`, `disableAccountAction`, `enableAccountAction`, `removePrerequisiteAction`, `requestCorrectionFromStudentGradesAction` ("Failed query … invalid input syntax for type uuid" in the server log; the client sees only "Internal Server Error", no SQL leaks).
- **Fix:** One shared `isUuid` guard turning these into a `ValidationError`. **Risk:** L. **Effort:** S.

### BUG-05 — Permission refusals and "not signed in" surface as 500s
- **Severity:** Low
- **Location:** `requireActor()` throws for anonymous callers (every action and the 4 CSV routes); `findPlanAction` (`admin/planning/actions.ts:129`), `logTranscriptPrintAction`, `logOwnTranscriptPrintAction` throw `ForbiddenError`/`Error` uncaught.
- **Proof:** `tests/03-authz.mjs` B1b: 76 of 76 actions return 500 to an anonymous caller (and the CSV routes 500 instead of 401); the action never runs, so it is safe, but the logs fill with stack traces and a monitor sees real outages.
- **Fix:** Return 401/403 (routes) or redirect to `/login` (actions); catch `ForbiddenError` in those three actions. **Risk:** L. **Effort:** S.

### BUG-06 — Semester transition to an unknown state prints "to undefined"
- **Severity:** Low (cosmetic; the change is refused)
- **Location:** `transitionSemesterAction` message path. Proof: `tests/12-input.mjs` — `OPEN → BOGUS` → "Open semester to undefined…". **Fix:** validate `toState` against the enum first. **Risk:** L. **Effort:** S.

---

## 3. Findings — SUSPECTED (need a check on your hosted Supabase/Vercel; see section 5)

- **SUS-01 (feeds SEC-01/SEC-05/SEC-06) — Is the `app` or `audit` schema exposed through the Supabase REST API?** If neither is exposed, SEC-05 and the database half of SEC-06 are theoretical. Query in section 5.
- **SUS-02 (feeds SEC-01) — Shared login rate limit.** Because `signInWithPassword` runs on the server, Supabase sees one IP for all users; its built-in limit then protects nobody individually and may block everyone during an attack.
- **SUS-03 — Hosted-Supabase Auth settings** that cannot be seen from the repo: public sign-ups, leaked-password protection, JWT lifetime, session time-box/inactivity, MFA for staff, redirect-URL allow-list.
- **SUS-04 — Vercel**: preview deployments sharing the production Supabase project (the repo's own `migrate.yml` comments warn about this), and the `PRODUCTION_DATABASE_URL` secret decision you already have open.

## 4. Info (no action required unless you want it)

- **INFO-01** `app.permission` (the role matrix) is readable by any `authenticated` database user; `anon` has `USAGE` on schema `app` but no table privileges (`tests/results/05-rls-counts.txt`).
- **INFO-02** The activity cookie is signed with `SUPABASE_SERVICE_ROLE_KEY` (`src/proxy.ts:208`). Works; a separate secret would be cleaner.
- **INFO-03** `audit.audit_log` has no trigger stopping UPDATE/DELETE by the table owner; the app never does it (and you used this to clear the log on purpose).
- **INFO-04** A Server Action POST with **no** `Origin` header is accepted (normal Next behaviour; browsers always send `Origin` on cross-site POSTs, and wrong/`null` origins are refused — tests F-csrf-origin, F-csrf-null).
- **INFO-05** Permission changes take up to 60 s to apply (documented cache in `src/lib/permissions/kernel.ts`).

---

## 5. Manual actions for you (read-only checks and dashboard settings)

Run these in the **Supabase SQL editor of the production project** (all `SELECT`, nothing changes) and send me the results if anything looks odd:

```sql
-- 1. Which schemas does the Supabase API expose? Expect: public,graphql_public (NOT app, NOT audit)
select rolname, rolconfig from pg_roles where rolname = 'authenticator';

-- 2. Can the API roles see/touch our schemas? (expect anon: app = true is harmless, audit = false)
select r, s, has_schema_privilege(r, s, 'USAGE')
from (values ('anon'),('authenticated')) a(r), (values ('app'),('audit')) b(s);

-- 3. Is RLS on for every table? Expect rowsecurity = true everywhere (25 tables)
select schemaname, tablename, rowsecurity from pg_tables where schemaname in ('app','audit') order by 1,2;
```

Dashboard (Authentication → …), because the app cannot enforce them:
1. **Sign-ups:** turn **off** "Allow new users to sign up" (accounts are created only by staff).
2. **Rate limits:** review "sign-ins" limits and enable CAPTCHA/Turnstile on sign-in (SEC-01/SUS-02).
3. **Leaked-password protection** and a minimum length of at least 8 (student rule is 6 today — your call).
4. **Sessions:** time-box and inactivity timeout if your plan has them (backs up SEC-03/04); keep JWT expiry at 1 h.
5. **MFA (TOTP)** for Super Admins and Admins.
6. **URL configuration:** Site URL = the production domain only; remove wildcard/preview redirect URLs.
7. **Vercel:** make sure Preview deployments do not use production Supabase keys/DATABASE_URL.

---

## 6. What I tested and found secure (no padding — each backed by a test)

| Area | Result | Evidence |
|---|---|---|
| Server Actions × roles | 76 actions × {anonymous, student, admin, super admin}: **no action runs for an anonymous caller**; every action a role is not entitled to answers "Not available to your role" or is blocked before it runs; matches the permission matrix | `03-authz.mjs`, `results/03-authz.json` |
| Service layer | 121 exported functions that take an actor: 114 show a permission/ownership guard; the other 7 were read by hand and are guarded through a helper or are read-only | `04-static-authz-scan.mjs` |
| Student ↔ student (IDOR) | A cannot add/remove/submit/delete B's course plan (DB unchanged); A cannot fetch B's photo (404); a student sees only own rows in every table | `06-routes-idor.mjs`, `05-rls.sh` |
| Route access | Every `/admin/*` page shows "Not available" to a student (except `/admin/offerings`, which is the student course catalogue by design); staff-only CSV exports return 403 to students and an uncaught 500 to anonymous callers (BUG-05) | `06-routes-idor.mjs` |
| Database (RLS) | `anon`: zero table access. Student: cannot change `app_user.role`, grades, colleges, semesters, permissions or the audit log; can read only own rows of the 6 student-data tables; cannot read the audit log. (One exception: SEC-05) | `05-rls.sh`, grants/policies dumps in `data/` |
| Password reset | An old session cannot take over an account after an admin reset; temporary passwords are random 10-char via `crypto.randomInt`; forced change cannot be bypassed (11 URLs, actions, `x-middleware-subrequest` header) | `01-auth.mjs`, `02-session.mjs` |
| Logout | Replaying a session cookie after logout fails | A6a |
| Changing password | Requires the current password, applies the role's policy, role read from DB | code + A4 |
| Injection | All 14 raw `sql` fragments are parameterised; hostile search/page values never 500; garbage audit filters never 500 | `12-input.mjs` |
| XSS | Script/markup in student name, address, parent, county, degree, minor is rendered as text on 8 pages incl. transcript and grade sheet; CSP uses a per-request nonce | `12-input.mjs` |
| CSV injection | Exports neutralise `=`, `+`, `-`, `@`, tab, CR (`src/lib/export/csvCell.ts`, used by all three exporters) | code review |
| Uploads | SVG/HTML relabelled as PNG/JPEG and real SVG are rejected by content sniffing; a JPEG-header polyglot is served only as `image/jpeg` with `nosniff` | `13-misc.mjs` |
| CSRF / CORS | Foreign and `null` `Origin` on a Server Action are refused; no CORS headers on any route | `11-web.mjs` |
| Headers | CSP (nonce), HSTS 2 years, `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy on pages | `curl -I` in this session |
| Error leakage | Unknown action id, malformed ids and bad pages return bare errors; no stack or SQL in any response | `11-web.mjs` |
| Redirects | No `next`/`redirect` parameter is honoured on login | `11-web.mjs` |
| Secrets | None in tracked files, in all 142 commits, or in the client bundle; `.env*` ignored; service-role key only read server-side | grep + `.next/static` scan |
| Business rules | Grade life-cycle DRAFT→SUBMITTED→PUBLISHED works; draft hidden from the student at DB level; no edit after submit/publish; admin cannot publish or decide corrections; double approval in parallel produces one record per grade; correction updates grade + record + GPA (B- = 2.70); semester machine refuses every illegal jump, reopening needs Super Admin **and** a reason, one In-Progress semester at a time; seat capacity is row-locked | `10-grades.mjs`, `10b-grades-tail.mjs`, `12-input.mjs` |
| Audit trail | Disables, grade entry/submission/approval/publication/corrections, exports, prints and log views are all recorded; no passwords in the log | `10b` audit listing, `13-misc.mjs` |

---

## 7. Prioritised fix plan (nothing is done yet — waiting for your approval)

Order inside each batch is least-risky first. Each fix = one commit `fix(security): SEC-xx …`, with a test that fails before and passes after, then typecheck/lint/build/tests; anything that breaks the Phase 0 baseline is reverted. Branch: `security/audit-fixes` (created only after your go-ahead). No push until you approve screenshots.

**Batch 1 — High (3)**
| Order | ID | Files | New migration | Dependency | Env/dashboard | Logout / data impact |
|---|---|---|---|---|---|---|
| 1 | BUG-01 body-size limit | `next.config.ts`, photo/import screens (message) | no | no | no | none |
| 2 | SEC-02 patch Next/sharp/source-map-js | `package.json`, lockfile | no | **yes (patch only; needs your OK)** | no | none |
| 3 | SEC-01 login throttling (+ SEC-07 login audit shares the table) | `src/app/login/actions.ts`, new `src/lib/auth/loginThrottle.ts` | **yes** + rollback | no | dashboard CAPTCHA/limits (manual) | none; a locked-out student waits instead of being locked for good |

**Batch 2 — Medium (6)**
| Order | ID | Files | Migration | Notes |
|---|---|---|---|---|
| 4 | BUG-02 strict score parsing (also removes BUG-03) | 3 action files, `engine.ts` mapping | no | none |
| 5 | SEC-03 enforce 12 h session cookie | `server.ts`, `proxy.ts`, `cookieOptions.ts` | no | **everyone logged out once after deploy** |
| 6 | SEC-04 idle check cannot be skipped | `src/proxy.ts`, `src/app/login/actions.ts` | no | none after deploy |
| 7 | SEC-07 login audit events | `login/actions.ts`, audit helper | no (shares SEC-01 table) | none |
| 8 | SEC-05 audit insert policy | — | **yes** + rollback | full integration suite must stay green |
| 9 | SEC-06 disable = ban + status-aware `current_user_role()` | `accounts.ts`, `supabase/admin.ts` | **yes** + rollback | disabled users' tokens stop working at Supabase |

**Batch 3 — Low and bugs**
`BUG-03` (covered by BUG-02), `BUG-04` uuid guard, `BUG-05` clean 401/403, `BUG-06` state validation, `SEC-08` timing, `SEC-09` proxy redirect for anonymous, `SEC-10` `poweredByHeader:false`.

Things I will **not** do without a separate decision from you: raising student password rules, changing the 1 h idle / 12 h session numbers, moving to Next 16.4, or touching Supabase/Vercel settings (section 5 is for you).

---

## 8. How to re-run everything (local only)

```
security-audit/tests/local-stack.sh        # starts/checks the local stack (refuses non-loopback)
node security-audit/tests/00-setup-accounts.mjs
node security-audit/tests/01-auth.mjs      # A1, A2, A4, A5, A6
node security-audit/tests/02-session.mjs   # A7, password-reset takeover
node security-audit/tests/03-authz.mjs     # every action × every role
node security-audit/tests/04-static-authz-scan.mjs
security-audit/tests/05-rls.sh             # DB role visibility
node security-audit/tests/06-routes-idor.mjs
node security-audit/tests/07-disable.mjs
node security-audit/tests/08-limits.mjs
NODE_OPTIONS=--conditions=react-server npx tsx security-audit/tests/helpers/gpa-edges.ts
node security-audit/tests/10-grades.mjs && node security-audit/tests/10b-grades-tail.mjs
node security-audit/tests/11-web.mjs; node security-audit/tests/12-input.mjs; node security-audit/tests/13-misc.mjs
```
Scripts 10 and 12 change data in the **local** database (grades, a semester state, a college row); rebuild the local database before re-running them.
