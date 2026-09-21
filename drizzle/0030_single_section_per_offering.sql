-- Every course offering becomes Section 1.
--
-- The College teaches one section of a course in a semester. The data was
-- entered as "Section A" and "Section B" before that was settled, and
-- 0029 read those literally -- A became 1, B became 2 -- because a
-- migration that collapsed them would have been guessing. Now the College
-- has said: there is one section, and it is 1.
--
-- The catch is uniqueness. course_offering_unique_section_idx is on
-- (semester_id, course_id, section), so two offerings of the SAME course
-- in the SAME semester genuinely cannot both be section 1. Those are
-- renumbered 1, 2, 3 ... in their existing order instead of being
-- collapsed, because collapsing them would mean deleting a class that is
-- really being taught. In practice every course offered once per semester
-- -- which is all of them -- lands on 1.

-- Done in two passes, and the reason is not caution for its own sake.
-- A single UPDATE that renumbers 2 -> 1 and 5 -> 2 can transiently break
-- the unique index, because a plain unique index is checked row by row and
-- row 5 may be rewritten before row 2 has moved out of the way. Parking
-- everything above any real section number first means neither pass can
-- ever collide with a row it has not reached yet.

-- Pass 1: move every section out of the way. Still numeric, so the CHECK
-- from 0029 holds throughout.
UPDATE "app"."course_offering"
   SET "section" = ("section"::int + 1000000)::text
 WHERE "section" ~ '^[0-9]+$' AND "section"::int < 1000000;
--> statement-breakpoint

-- Pass 2: number each (semester, course) group from 1, keeping the order
-- the sections were already in. Re-running this migration is harmless:
-- pass 1 no-ops on values it has already moved back down, and this lands
-- on the same numbers again.
WITH "renumbered" AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "semester_id", "course_id"
           ORDER BY "section"::int, "id"
         )::text AS "new_section"
    FROM "app"."course_offering"
)
UPDATE "app"."course_offering" AS "o"
   SET "section" = "r"."new_section"
  FROM "renumbered" AS "r"
 WHERE "o"."id" = "r"."id";
