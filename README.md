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

## Governance documents

- `DECISIONS.md` — engineering and College decisions, open and closed
- `ASSUMPTIONS.md` — assumptions still awaiting validation, and their cost if wrong
- Stage-by-stage build plan, gates, and acceptance criteria: plan document, Sections 24–27

## Status

Stage 1 (Foundation and Platform) — in progress on branch `stage/01-foundation`.
