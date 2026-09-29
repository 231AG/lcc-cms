-- Older letter grades for past records.
--
-- The College's grade sheets before the current scale used plain letters:
-- A, B, C and D, worth 4, 3, 2 and 1 grade points. The current scale has
-- only the +/- letters (A+, A-, B+ ...), so a plain "B" had nowhere to go
-- and a past record could not be entered without changing its grade.
-- The College decided (28 Sep 2026) to keep those records exactly as they
-- were issued: the four plain letters join the scale as older grades.
--
-- `is_legacy` marks them. An older grade is accepted when a past record is
-- entered, counts in GPA and CGPA like any other letter, and is shown on a
-- grade sheet that contains one -- but it has no score band, so it can
-- never be produced by grade entry for a current class, and it is left out
-- of the grading key printed for the current scale.
--
-- Added to every policy version already present, so the version a past
-- record is computed under always knows these letters. Idempotent: the
-- ON CONFLICT leaves a row that already exists untouched.

ALTER TABLE "app"."grade_scale" ADD COLUMN IF NOT EXISTS "is_legacy" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
INSERT INTO "app"."grade_scale"
  ("policy_version", "letter", "min_score", "max_score", "grade_point", "counts_in_gpa", "counts_in_attempted", "counts_in_earned", "is_passing", "display_order", "effective_from", "is_legacy")
SELECT v."policy_version", l."letter", NULL, NULL, l."grade_point", true, true, true, true, l."display_order", v."effective_from", true
FROM (
  SELECT "policy_version", min("effective_from") AS "effective_from"
  FROM "app"."grade_scale"
  GROUP BY "policy_version"
) v
CROSS JOIN (VALUES
  ('A', 4.00::numeric(3,2), 11),
  ('B', 3.00::numeric(3,2), 12),
  ('C', 2.00::numeric(3,2), 13),
  ('D', 1.00::numeric(3,2), 14)
) AS l("letter", "grade_point", "display_order")
ON CONFLICT ("policy_version", "letter") DO NOTHING;
