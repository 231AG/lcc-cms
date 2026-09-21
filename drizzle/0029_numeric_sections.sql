-- Sections are numbers, not letters.
--
-- The College numbers its sections: a course taught twice is section 1 and
-- section 2. The column has always been free text and the data drifted to
-- single letters, which is what every screen has been showing.
--
-- Two halves: rewrite what is there, then stop it happening again.

-- 1. A -> 1, B -> 2, ... Z -> 26. Case-insensitive, and anything already
--    numeric is left exactly as it is, so re-running this is harmless.
--
--    ascii('A') is 65, so ascii(upper(section)) - 64 maps A..Z onto 1..26.
--    Deliberately NOT a hand-written CASE of 26 branches: one expression
--    cannot disagree with itself halfway down the alphabet.
UPDATE "app"."course_offering"
   SET "section" = (ascii(upper(trim("section"))) - 64)::text
 WHERE trim("section") ~ '^[A-Za-z]$';

-- 2. Anything else that is not already a number -- a stray "A1", a blank --
--    has no honest automatic reading, so it is left alone and the
--    constraint below will refuse to be added while it exists. That is the
--    point: a migration that silently invented a section number for a row
--    it could not interpret would be worse than one that stops and asks.
ALTER TABLE "app"."course_offering"
  ADD CONSTRAINT "course_offering_section_numeric"
  CHECK ("section" ~ '^[0-9]+$');
