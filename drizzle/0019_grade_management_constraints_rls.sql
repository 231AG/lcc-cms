-- Stage 10: grade_submission/grade_record/grade_correction_request
-- uniqueness, grants, and RLS (Section 9.4.11/9.4.12/9.4.13, 15.1-15.5).

-- "At most one SUBMITTED submission per offering at a time" (9.4.11) plus
-- the plain uniqueness the entity spec states directly.
CREATE UNIQUE INDEX grade_submission_unique_offering_attempt_idx
  ON app.grade_submission (offering_id, attempt_no);
CREATE UNIQUE INDEX grade_submission_one_active_idx
  ON app.grade_submission (offering_id)
  WHERE status IN ('SUBMITTED', 'PARTIALLY_DECIDED');
CREATE INDEX grade_submission_status_idx ON app.grade_submission (status);

-- "One grade_record per registration" (9.4.12 Uniqueness) -- the database
-- expression of REQ-G03's duplicate rejection.
CREATE UNIQUE INDEX grade_record_unique_registration_idx
  ON app.grade_record (registration_id);
CREATE INDEX grade_record_submission_idx ON app.grade_record (submission_id);
CREATE INDEX grade_record_status_idx ON app.grade_record (status);

-- "Only one PENDING request per grade at a time" (9.4.13 Constraints).
CREATE UNIQUE INDEX grade_correction_one_pending_idx
  ON app.grade_correction_request (grade_record_id)
  WHERE status = 'PENDING';
CREATE INDEX grade_correction_grade_record_idx ON app.grade_correction_request (grade_record_id);
--> statement-breakpoint

-- Every write in this domain runs through the raw superuser connection
-- (DEV-03's pattern, same as course_plan/registration): the whole-class
-- one-transaction save, the segregation-of-duties re-check at decision
-- time, the row-locked approval transaction, and the correction
-- staleness check all need guarantees RLS cannot express as a per-row
-- policy. RLS here is read-only for authenticated -- no write policy at
-- all, matching academic_record and course_plan's own shape.
GRANT SELECT ON app.grade_submission, app.grade_record, app.grade_correction_request TO authenticated;
GRANT ALL ON app.grade_submission, app.grade_record, app.grade_correction_request TO service_role;

ALTER TABLE app.grade_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.grade_submission FORCE ROW LEVEL SECURITY;
ALTER TABLE app.grade_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.grade_record FORCE ROW LEVEL SECURITY;
ALTER TABLE app.grade_correction_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.grade_correction_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- grade_submission and grade_correction_request are not student-facing
-- concepts at all (Section 11.3 has no Student row for either) -- Admin
-- and Super Admin both see everything, matching academic_record's shape
-- for staff roles.
CREATE POLICY grade_submission_select_staff ON app.grade_submission
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY grade_correction_select_staff ON app.grade_correction_request
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

-- grade_record: THE control this whole workflow exists to provide
-- (Section 15.1) -- a student may never see a DRAFT or SUBMITTED grade,
-- only PUBLISHED/LOCKED ones, and only their own. Admin/Super Admin see
-- every grade regardless of status (both need visibility into drafts and
-- submissions under review, Section 11.3's "View draft grades" row).
CREATE POLICY grade_record_select_staff ON app.grade_record
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY grade_record_select_own_published ON app.grade_record
  FOR SELECT TO authenticated
  USING (
    status IN ('PUBLISHED', 'LOCKED')
    AND EXISTS (
      SELECT 1 FROM app.registration r
      WHERE r.id = grade_record.registration_id AND r.student_id = auth.uid()
    )
  );
