-- A student's middle name.
--
-- Deliberately nullable with no default and no check constraint: a middle
-- name is optional in the enrolment form and genuinely absent for many
-- students, so NULL means "none recorded" and every existing row is already
-- correct without a backfill. An empty string is never written -- the
-- service layer trims and coerces "" to NULL, so there is exactly one
-- representation of "no middle name" in the column.
--
-- No index: nothing filters or sorts by middle name on its own. The student
-- search does now match against it (searchStudents' ILIKE), but that is an
-- OR arm on an already-unindexed pattern scan over a few hundred rows, not
-- a new access path.
--
-- No RLS change: student's policies are per-column-set-agnostic (own row for
-- Student, all rows for staff -- Section 9.4.2) and a new column on the
-- table is covered by them as they stand.

ALTER TABLE "app"."student"
  ADD COLUMN "middle_name" text;
