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
ALTER TABLE "app"."student"
  ADD COLUMN "date_of_birth" date,
  ADD COLUMN "country_of_origin" text,
  ADD COLUMN "county_of_origin" text,
  ADD COLUMN "parent_guardian" text,
  ADD COLUMN "address" text,
  ADD COLUMN "accepted_from" text,
  ADD COLUMN "enrollment_status" text,
  -- The day the student enrolled, when the office has it. enrolment_year
  -- (from the Student ID) stays the required figure; this only refines it.
  ADD COLUMN "enrolment_date" date,
  ADD COLUMN "degree" text,
  ADD COLUMN "graduation_date" date,
  ADD COLUMN "distinction" text;
