-- Stage 5: student uniqueness, format constraint, grants, and RLS
-- (Section 9.4.2, 10.5, 18.4).

-- student_number is the College's Student ID (DEC-02/CR-08): digits only,
-- first four digits the admission year, 6-8 digits total. Enforced again
-- here, not only in the service layer, matching this project's
-- belt-and-suspenders pattern for formats that must never drift.
ALTER TABLE app.student ADD CONSTRAINT student_number_format_check
  CHECK (student_number ~ '^(19|20)[0-9]{2}[0-9]{2,4}$');

-- Unique across the whole institution, including graduated/withdrawn
-- students -- reuse of a retired Student ID is prohibited regardless of how
-- DEC-02 is answered (Section 9.4.2).
CREATE UNIQUE INDEX student_number_unique_idx ON app.student (trim(student_number));
--> statement-breakpoint

ALTER TABLE app.student ADD CONSTRAINT student_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.app_user(id) ON DELETE RESTRICT;
ALTER TABLE app.student ADD CONSTRAINT student_import_completed_by_fkey
  FOREIGN KEY (import_completed_by) REFERENCES app.app_user(id) ON DELETE RESTRICT;
--> statement-breakpoint

-- student: same shape as app_user's own RLS (Section 9.4.1) -- reads only
-- for `authenticated`, no INSERT/UPDATE/DELETE policy at all. Enrolment
-- must coordinate a Supabase Auth user (external, non-transactional) with
-- both the app_user and student rows atomically (Section 24.6's "a failure
-- leaves neither user nor profile"), and profile edits update app_user's
-- display_name alongside student's own fields -- both are therefore
-- service-layer-gated, superuser-connection writes (the same
-- "service-layer gate + superuser write + audit" pattern as DEV-03), not
-- asUser()/RLS-mediated writes. RLS here governs reads only, which is
-- where a cross-student leak would actually show up (Section 18.4's
-- single most important negative test in the system).
GRANT SELECT ON app.student TO authenticated;
GRANT ALL ON app.student TO service_role;

ALTER TABLE app.student ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY student_select_own ON app.student
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY student_select_staff ON app.student
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));
