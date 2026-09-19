# Supabase checklist — things only you can do

Four items from the September 2026 security review that **could not be verified from the
development environment**, because its network policy blocks Supabase. Everything in that
review about row-level security was checked against `drizzle/*.sql` and a local Postgres
carrying the same schema — never against the live project.

Each item below is independent. None of them needs a code change or a deploy.

**Roughly 20 minutes in total.** Item 1 is the one that matters most; items 2–4 are each
a single dashboard toggle.

---

## 1. Confirm the live policies match the migrations

**Why.** Every student-facing read in this app — grade sheet, academic record, GPA,
history — passes a `studentId` as an ordinary argument with no service-layer check that
it belongs to the caller. They are safe *only* because they read through `asUser()`, so
Postgres RLS decides what comes back. If a policy was ever edited by hand in the
dashboard, or dropped and not recreated, the migrations would no longer describe what is
actually enforced, and nothing in CI would notice.

**How.** Supabase dashboard → **SQL Editor** → new query → paste and run:

```sql
-- A. Every table must have RLS enabled. Anything with rls_enabled = false is a hole.
SELECT c.relname                AS table_name,
       c.relrowsecurity         AS rls_enabled,
       c.relforcerowsecurity    AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, c.relname;
```

**Expect:** 23 rows, `rls_enabled = true` on every one. `rls_forced` is true on 21;
`grade_scale` and `institution_setting` are the two exceptions and that is fine — they
are reference data, and the `authenticated` role is subject to the policies either way.

> ⚠️ **If any row shows `rls_enabled = false`, stop and tell me.** That is a live data-exposure
> issue, not a cleanup item.

```sql
-- B. The student-facing policies. These are the ones that keep one student out of
--    another student's transcript.
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'app'
  AND tablename IN ('academic_record', 'student', 'course_plan',
                    'registration', 'student_cumulative_summary',
                    'student_semester_summary', 'grade_record')
ORDER BY tablename, cmd, policyname;
```

**Expect** each student-scoped `SELECT` policy to contain either `student_id = auth.uid()`
(or `id = auth.uid()` on `student`) or a staff-role check. Specifically:

| Table | Policy should say |
| :--- | :--- |
| `academic_record` | `(student_id = auth.uid()) AND (NOT is_void)` — plus a staff policy |
| `student` | `id = auth.uid()` — plus a staff policy |
| `course_plan` | `current_user_role() = 'ADMIN' OR student_id = auth.uid()` |
| `registration` | `current_user_role() = 'ADMIN' OR student_id = auth.uid()` |
| `student_cumulative_summary` | `student_id = auth.uid()` — plus a staff policy |

**If a policy is missing entirely**, that table is readable by any signed-in user. Send me
the output and I will write the migration.

> **Known, already logged, not urgent:** `course_plan` and `registration` name `'ADMIN'`
> but not `'SUPER_ADMIN'`. That is a correctness bug, not a hole — it **fails closed**, so a
> Super Admin reading through `asUser()` sees *less* than they should, never more. It is
> why enrolment counts are read through the raw connection instead.

---

## 2. Turn on leaked-password protection

**Why.** Supabase can check every new password against the Have I Been Pwned corpus and
refuse known-breached ones. **It is off by default.** The app already blocks the obvious
choices (`src/lib/identity/passwordPolicy.ts`), but that is a short hand-written list, not
a billion-row breach corpus.

**How.** Dashboard → **Authentication** → **Policies** (or **Providers → Email**, depending
on your dashboard version) → find **"Prevent use of leaked passwords"** → turn it **on**.

**Effect.** Users setting a breached password get an error at the Supabase layer. No code
change; this app already surfaces Supabase's refusal on the change-password screen.

---

## 3. Check the auth rate limits

**Why.** This app does **no** login rate limiting of its own. Brute-force protection is
entirely Supabase's, so it is worth knowing what the numbers actually are rather than
assuming there are any.

**How.** Dashboard → **Authentication** → **Rate Limits**.

Look at **"Sign in / Sign up"** (per-hour, per-IP). The default is generous for a college
portal with a few dozen staff and a few hundred students. Tightening it is low-risk and
raises the cost of a password-guessing run considerably.

**Also relevant now:** the password-change screen calls `signInWithPassword` to verify the
current password, so that endpoint's limit covers re-authentication too — another reason
not to leave it wide open.

---

## 4. Check the JWT expiry

**Why.** The session cookie's `maxAge` is 12 hours (`src/lib/supabase/cookieOptions.ts`),
but **that only controls the cookie, not the token inside it.** The real token lifetime is a
project setting. If the JWT lives far longer than the cookie, a token captured elsewhere
stays valid past the point the browser would have stopped sending it.

**How.** Dashboard → **Authentication** → **Sessions** (or **Settings**, by version) →
**JWT expiry**.

Bringing it in line with the 12-hour cookie — or shorter — makes the two agree. Refresh
tokens keep sessions working across that boundary, so shortening it is not as disruptive
as it sounds.

---

## Nothing else is waiting on you

The code side of the review is merged or in PR #13. Specifically **not** on this list,
because it is already handled in code:

- **HSTS** — Vercel sends it on `*.vercel.app`, and as of PR #13 the app sends it too, so
  the guarantee survives a move to a custom domain or another host.
- **Session cookie flags** — `httpOnly`, `Secure` in production, `SameSite=Lax`, 12h.
- **CSP** — nonce-based `script-src`, `frame-ancestors 'none'`, `object-src 'none'`.

## When you have been through it

Tell me what items 1–4 showed. Item 1 is the only one that might produce work; the other
three are either on or off, and if they are off now they will be on in a minute.
