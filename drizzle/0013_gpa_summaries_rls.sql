-- Stage 7: RLS and grants for the GPA summary tables (Section 9.4.15, 10.5).
--
-- Identical treatment to academic_record: read-only for `authenticated`, no
-- INSERT/UPDATE/DELETE policy at all. "No user writes these directly;
-- there is no UI that edits them" (9.4.15) -- only the recomputation
-- service, running on the superuser connection inside the same
-- transaction as the change that triggered it, ever writes these rows.

GRANT SELECT ON app.student_semester_summary, app.student_cumulative_summary TO authenticated;
GRANT ALL ON app.student_semester_summary, app.student_cumulative_summary TO service_role;

ALTER TABLE app.student_semester_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student_semester_summary FORCE ROW LEVEL SECURITY;
ALTER TABLE app.student_cumulative_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student_cumulative_summary FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY student_semester_summary_select_own ON app.student_semester_summary
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY student_semester_summary_select_staff ON app.student_semester_summary
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY student_cumulative_summary_select_own ON app.student_cumulative_summary
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY student_cumulative_summary_select_staff ON app.student_cumulative_summary
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));
