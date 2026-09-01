# Liberia Christian College E-Portal — Phase 1

Academic information system for Liberia Christian College: authentication and role-based access,
academic setup, student records, historical record import, grade management with GPA/CGPA, course
planning, scheduling, and audit logging.

The controlling specification is `LCC_EPortal_Phase1_Development_Plan_v2.1.pdf` in this repository.
Do not implement anything that contradicts it without recording the deviation in `DECISIONS.md`.

## Stack

Next.js (App Router, TypeScript) · Supabase (Postgres + Auth) · Drizzle ORM · Row-Level Security ·
Tailwind CSS · Vitest + Playwright · Vercel.

## Local development

See [`docs/SETUP.md`](docs/SETUP.md).

## Using the system

- [`docs/ADMIN_MANUAL.md`](docs/ADMIN_MANUAL.md) — for Admin and Super Admin staff
- [`docs/STUDENT_GUIDE.md`](docs/STUDENT_GUIDE.md) — for students

## Operations

- [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md)
- [`docs/BACKUP_RESTORE_RUNBOOK.md`](docs/BACKUP_RESTORE_RUNBOOK.md) — **read this before calling anything
  here "production"; there is currently no working backup**
- [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md)
- [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) — Stage 11's control-by-control self-review against plan §18

## Governance documents

- `DECISIONS.md` — engineering and College decisions, open and closed
- `ASSUMPTIONS.md` — assumptions still awaiting validation, and their cost if wrong
- `AS_BUILT.md` — where this build departs from the plan, and what's still needed to reach Go-Live
- Stage-by-stage build plan, gates, and acceptance criteria: plan document, Sections 24–27

## Status

All eleven Phase 1 stages have working code, merged to `main` (fast-forwarded from
`stage/11-hardening-go-live` on 1 Sep 2026 — no divergent history, nothing rewritten). **This is a
functional pilot, not a plan-Go-Live-certified production system** — see `AS_BUILT.md` for exactly what
remains (backup/restore, UAT, a few open College decisions) before it can be called that.
