-- Every course offering is Section 1.
--
-- The College teaches one section of a course in a semester. The data was
-- entered as "Section A" and "Section B" before that was settled, and the
-- College has now said there is one section and it is 1.
--
-- 0029 already renumbers densely from 1 within each (semester, course),
-- so on a database that has just run it this migration changes nothing.
-- It is here for the databases where 0029 ran in its ORIGINAL form, which
-- mapped letters by value -- A to 1, B to 2 -- and so left a course whose
-- only section was "B" sitting on 2 forever.
--
-- The catch, either way, is uniqueness. course_offering_unique_section_idx
-- is on (semester_id, course_id, section), so two offerings of the SAME
-- course in the SAME semester genuinely cannot both be section 1. Those
-- are renumbered 1, 2, 3 ... rather than collapsed, because collapsing
-- would mean losing a class that is really taught. In practice every
-- course offered once per semester -- which is all of them -- lands on 1.
--
-- Same two-pass shape as 0029, for the same reason: a plain unique index
-- is checked row by row, so rewriting 5 -> 2 before 2 has moved out of the
-- way is a violation, and nothing guarantees the order. Parking first
-- removes the dependency on row order entirely. Re-running is a no-op.

-- Pass 1: park, on a base above every number currently in use.
WITH "base" AS (
  SELECT coalesce(max("section"::bigint), 0) + 1 AS "n" FROM "app"."course_offering"
),
"parked" AS (
  SELECT "id",
         ((SELECT "n" FROM "base")
          + row_number() OVER (ORDER BY "semester_id", "course_id", "section"::bigint, "id"))::text AS "tmp"
    FROM "app"."course_offering"
)
UPDATE "app"."course_offering" AS "o"
   SET "section" = "p"."tmp"
  FROM "parked" AS "p"
 WHERE "o"."id" = "p"."id";
--> statement-breakpoint

-- Pass 2: dense from 1 within each course and semester.
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
