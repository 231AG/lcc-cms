-- The details an academic transcript prints that the student record did not
-- hold yet: personal particulars, where the student came from, and how the
-- programme ended.
--
-- Every column is OPTIONAL. Most of these are not known for the students
-- already in the system, and the College asked for blanks rather than
-- guesses -- NULL means "not recorded", and the transcript prints a dash.
-- The service layer stores a blank form field as NULL, never "", the same
-- rule as middle_name and minor.
--
-- Plain text rather than lookups or enums: an address, a guardian's name
-- or a previous school is whatever the paper record says. The degree
-- ("BA", "BSc") and distinction ("Cum Laude") are free text for the same
-- reason -- the College has not fixed a list, and a CHECK here would have
-- to be migrated every time it added one.
--
-- IF NOT EXISTS so this can be pasted into the Supabase SQL editor ahead
-- of a deploy, and the Migrate workflow running it again afterwards is a
-- no-op rather than a failure.
ALTER TABLE "app"."student"
  ADD COLUMN IF NOT EXISTS "date_of_birth" date,
  ADD COLUMN IF NOT EXISTS "country_of_origin" text,
  ADD COLUMN IF NOT EXISTS "county_of_origin" text,
  ADD COLUMN IF NOT EXISTS "parent_guardian" text,
  ADD COLUMN IF NOT EXISTS "address" text,
  ADD COLUMN IF NOT EXISTS "accepted_from" text,
  ADD COLUMN IF NOT EXISTS "enrollment_status" text,
  -- The day the student enrolled, when the office has it. enrolment_year
  -- (from the Student ID) stays the required figure; this only refines it.
  ADD COLUMN IF NOT EXISTS "enrolment_date" date,
  ADD COLUMN IF NOT EXISTS "degree" text,
  ADD COLUMN IF NOT EXISTS "graduation_date" date,
  ADD COLUMN IF NOT EXISTS "distinction" text;
