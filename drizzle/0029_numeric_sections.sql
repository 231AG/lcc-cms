-- Sections are numbers, not letters.
--
-- The College numbers its sections: a course taught twice is section 1 and
-- section 2. The column has always been free text and the data drifted to
-- single letters, which is what every screen has been showing.
--
-- Two halves: rewrite what is there, then stop it happening again.

-- 1. Every offering is renumbered 1, 2, 3 ... within its own (semester,
--    course), in the order its sections already implied: numbers by value,
--    then letters by position in the alphabet, then anything else last.
--
--    THE OBVIOUS VERSION OF THIS IS WRONG, and was wrong in production.
--    A single `UPDATE ... SET section = ascii(upper(section)) - 64` looks
--    like the whole job, but course_offering_unique_section_idx is on
--    (semester_id, course_id, lower(trim(section))) and treats 'A' and '1'
--    as different values -- so a course can already hold both, one entered
--    before the app demanded numbers and one after. Mapping that 'A' onto
--    1 then collides with the 1 sitting next to it:
--
--      duplicate key value violates unique constraint
--      "course_offering_unique_section_idx"
--
--    So this parks every row on a number nothing else holds before
--    assigning the final ones. Two passes, and neither can collide with a
--    row it has not reached yet: a plain unique index is checked row by
--    row, and nothing guarantees the order rows are rewritten in.
--
--    A section this cannot read -- 'B2', a blank -- is not left behind for
--    the constraint below to trip over. It sorts last within its course
--    and takes the next free number. That is a deliberate change from the
--    first version of this migration, which stopped rather than invent a
--    number: now that the College has said a course has one section and it
--    is numbered, a dense number IS the honest reading, and refusing to
--    migrate leaves the letters on screen instead.

-- Pass 1: park, on a base above every number currently in use.
WITH "base" AS (
  SELECT coalesce(max(CASE WHEN trim("section") ~ '^[0-9]+$' THEN trim("section")::bigint END), 0) + 1 AS "n"
    FROM "app"."course_offering"
),
"ordered" AS (
  SELECT "id", "semester_id", "course_id",
         CASE
           WHEN trim("section") ~ '^[0-9]+$'   THEN trim("section")::bigint
           WHEN trim("section") ~ '^[A-Za-z]$' THEN ascii(upper(trim("section"))) - 64
           ELSE 2147483647
         END AS "sort_key"
    FROM "app"."course_offering"
),
"parked" AS (
  SELECT "id",
         ((SELECT "n" FROM "base")
          + row_number() OVER (ORDER BY "semester_id", "course_id", "sort_key", "id"))::text AS "tmp"
    FROM "ordered"
)
UPDATE "app"."course_offering" AS "o"
   SET "section" = "p"."tmp"
  FROM "parked" AS "p"
 WHERE "o"."id" = "p"."id";
--> statement-breakpoint

-- Pass 2: the real numbers, dense from 1 within each course and semester.
WITH "renumbered" AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "semester_id", "course_id"
           ORDER BY "section"::bigint, "id"
         )::text AS "new_section"
    FROM "app"."course_offering"
)
UPDATE "app"."course_offering" AS "o"
   SET "section" = "r"."new_section"
  FROM "renumbered" AS "r"
 WHERE "o"."id" = "r"."id";
--> statement-breakpoint

-- 2. Keep it that way.
ALTER TABLE "app"."course_offering"
  ADD CONSTRAINT "course_offering_section_numeric"
  CHECK ("section" ~ '^[0-9]+$');
