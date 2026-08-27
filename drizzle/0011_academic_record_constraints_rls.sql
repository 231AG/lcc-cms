-- Stage 6: academic_record uniqueness, indexes, grants, and RLS
-- (Section 9.4.14, 10.4, 10.5, 18.4).

-- Duplicate-prevention rule for both grade publication and historical
-- import, in one constraint (Section 9.4.14). Keyed on the frozen code
-- snapshot rather than course_id: an unrecognised course code has no
-- course_id (NULL), and NULL never equals NULL in a unique index, so
-- keying on course_id alone would silently let two unknown-course entries
-- for the same student/semester/attempt collide undetected. A voided row
-- is excluded -- it was wrong, so a corrected re-entry for the same
-- course must be allowed.
CREATE UNIQUE INDEX academic_record_no_duplicate_idx
  ON app.academic_record (student_id, semester_id, lower(trim(course_code_snapshot)), attempt_no)
  WHERE NOT is_void;

CREATE INDEX academic_record_student_idx ON app.academic_record (student_id);
CREATE INDEX academic_record_semester_idx ON app.academic_record (semester_id);
-- Powers the progress report's "unknown course" issue queue (Section
-- 17.5 validation #4 / A-16).
CREATE INDEX academic_record_unknown_course_idx ON app.academic_record (semester_id) WHERE course_id IS NULL AND NOT is_void;
--> statement-breakpoint

-- academic_record: same shape as student's own RLS (Section 9.4.1/9.4.2) --
-- reads only for `authenticated`, no INSERT/UPDATE policy at all. Entering
-- a semester's worth of records is one multi-row transaction with several
-- validations RLS cannot express (duplicate/conflict detection, origin
-- coherence, semester-must-be-in-the-past), so writes go through the same
-- "service-layer gate + superuser write + audit" path as DEV-03/DEV-05.
-- A student's own rows are visible as soon as entered, not gated on a
-- publish step imported rows don't have (Section 17.6: the provisional
-- marker, not visibility, is what changes before import status is
-- Complete) -- Stage 10's SYSTEM-origin rows will need their own
-- published-only policy added alongside this one, not instead of it.
GRANT SELECT ON app.academic_record TO authenticated;
GRANT ALL ON app.academic_record TO service_role;

ALTER TABLE app.academic_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.academic_record FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY academic_record_select_own ON app.academic_record
  FOR SELECT TO authenticated
  USING (student_id = auth.uid() AND NOT is_void);

CREATE POLICY academic_record_select_staff ON app.academic_record
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));
