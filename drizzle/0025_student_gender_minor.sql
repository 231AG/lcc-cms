-- Three changes to app.student, all driven by the enrolment form gaining
-- fields and the Student ID becoming editable.
--
-- 1. gender
--
-- Nullable with a CHECK, not NOT NULL with a default. The form makes it
-- required from now on, but every student already enrolled has no gender
-- recorded and there is no honest value to backfill them with: a default of
-- 'MALE' would silently assert something false about real people. NULL means
-- "not recorded", renders as an em dash, and the edit form surfaces the empty
-- field so the office can fill it in per student.
--
-- The CHECK admits exactly MALE and FEMALE, as specified. Same "enums as
-- CHECK, not native Postgres enums" convention as semester.state (Section
-- 10.3) -- if the set ever needs a third value, that is an ALTER of this
-- constraint, not a schema-lock operation on a type.
ALTER TABLE "app"."student"
  ADD COLUMN "gender" text;

ALTER TABLE "app"."student"
  ADD CONSTRAINT "student_gender_valid"
  CHECK ("gender" IS NULL OR "gender" IN ('MALE', 'FEMALE'));

-- 2. minor
--
-- Free text, nullable, no check: a minor is a genuinely optional secondary
-- field of study and the College has no controlled list of them. Same NULL
-- discipline as middle_name -- the service layer trims and coerces "" to
-- NULL so there is one representation of "no minor", and the grade sheet
-- prints N/A for it rather than an empty cell.
--
-- This is deliberately NOT a foreign key to department. A minor is not
-- always a department the College teaches degrees in, and making it one
-- would refuse to record the ones that are not.
ALTER TABLE "app"."student"
  ADD COLUMN "minor" text;

-- Note on Student ID uniqueness, which item 4 of this round asked to keep
-- enforced: nothing is needed here. 0009 already created
--   CREATE UNIQUE INDEX student_number_unique_idx ON app.student (trim(student_number));
-- which is stricter than a plain unique index on the column -- it also
-- collides " 202634" with "202634", matching the service layer, which trims
-- before it writes. The Admin edit path added this round relies on it.
