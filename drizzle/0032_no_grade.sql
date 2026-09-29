-- NG, "No Grade".
--
-- The College's grade sheets record NG where no grade was given. The
-- College decided (29 Sep 2026): NG is not counted -- no grade point, left
-- out of GPA, of hours attempted and of hours earned -- and must be
-- settled within two semesters. An NG still unsettled after that is
-- recorded as F by an Admin (the "NG to settle" list shows which are due
-- and which are overdue); nothing changes a student's grade on its own.
--
-- Added to every policy version already present, like the older letters
-- in 0031. Idempotent: an existing row or setting is left untouched.

INSERT INTO "app"."grade_scale"
  ("policy_version", "letter", "min_score", "max_score", "grade_point", "counts_in_gpa", "counts_in_attempted", "counts_in_earned", "is_passing", "display_order", "effective_from", "is_legacy")
SELECT v."policy_version", 'NG', NULL, NULL, NULL, false, false, false, false, 15, v."effective_from", false
FROM (
  SELECT "policy_version", min("effective_from") AS "effective_from"
  FROM "app"."grade_scale"
  GROUP BY "policy_version"
) v
ON CONFLICT ("policy_version", "letter") DO NOTHING;
--> statement-breakpoint
INSERT INTO "app"."institution_setting" ("key", "value", "description")
VALUES ('no_grade_resolution_semesters', '2'::jsonb, 'Decided 29 Sep 2026. An NG (No Grade) must be settled within two semesters; after that it is recorded as F.')
ON CONFLICT ("key") DO NOTHING;
