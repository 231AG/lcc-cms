-- The Dean of Admissions & Records is addressed as Pastor, not Mr.
--
-- A data change, not a schema one. It is here rather than in the seed
-- because the seed inserts institution settings with ON CONFLICT DO
-- NOTHING: on any installation that has already run it -- which is every
-- installation -- the old value would simply stay.
--
-- Guarded on the old value so it only ever corrects the seeded default. An
-- Admin who has since set the name from the grade sheet's own signature
-- editor has said something about who signs, and a migration is not
-- entitled to overwrite that. Idempotent: on a second run the WHERE no
-- longer matches and nothing happens.
UPDATE app.institution_setting
SET value = '"Pastor James M. Kaye"'::jsonb
WHERE key = 'grade_sheet_signed_name'
  AND value = '"Mr. James M. Kaye"'::jsonb;
