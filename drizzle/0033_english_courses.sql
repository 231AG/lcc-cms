-- The four English courses, as the College confirmed them (29 Sep 2026):
-- ENGL 101 Freshman English I, ENGL 102 Freshman English II, ENGL 201
-- Sophomore English I, ENGL 202 Sophomore English II -- four different
-- courses, 3 credit hours each. They were in the catalogue's "conflicts"
-- list (the programmes titled them differently), so the catalogue import
-- left them out, and past grade sheets that carry them could not be
-- matched.
--
-- Placed in Communication Arts, where the College put the other language
-- course (LANG). Added only when exactly one department has that name, and
-- only for a code the catalogue doesn't hold in any spelling ("ENGL101",
-- "ENGL 101"): an existing course is never touched or duplicated.

INSERT INTO "app"."course" ("department_id", "code", "title", "credit_hours", "is_active")
SELECT d."id", c."code", c."title", 3, true
FROM "app"."department" d
CROSS JOIN (VALUES
  ('ENGL101', 'Freshman English I'),
  ('ENGL102', 'Freshman English II'),
  ('ENGL201', 'Sophomore English I'),
  ('ENGL202', 'Sophomore English II')
) AS c("code", "title")
WHERE lower(trim(d."name")) = 'communication arts'
  AND (SELECT count(*) FROM "app"."department" WHERE lower(trim("name")) = 'communication arts') = 1
  AND NOT EXISTS (
    SELECT 1 FROM "app"."course" x
    WHERE regexp_replace(lower(x."code"), '\s', '', 'g') = lower(c."code")
  );
