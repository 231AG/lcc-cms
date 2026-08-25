-- Stage 3: normalized uniqueness, grants, and RLS for the academic
-- structure tables (Section 9.4.3/9.4.4, 10.5).

-- Text normalisation (Section 10.3): "CSC 201" and "csc 201" must not
-- become two different rows.
CREATE UNIQUE INDEX college_code_unique_idx ON app.college (lower(trim(code)));
CREATE UNIQUE INDEX department_code_unique_idx ON app.department (college_id, lower(trim(code)));
CREATE UNIQUE INDEX course_code_unique_idx ON app.course (lower(trim(code)));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON app.college, app.department, app.course, app.course_prerequisite TO authenticated;
GRANT ALL ON app.college, app.department, app.course, app.course_prerequisite TO service_role;

ALTER TABLE app.college ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.college FORCE ROW LEVEL SECURITY;
ALTER TABLE app.department ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.department FORCE ROW LEVEL SECURITY;
ALTER TABLE app.course ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course FORCE ROW LEVEL SECURITY;
ALTER TABLE app.course_prerequisite ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course_prerequisite FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Read: students (and everyone else) see only active rows; Admin sees
-- everything (needs to see inactive rows to manage them); Super Admin sees
-- everything too but read-only (Section 10.5, REQ-R03/R04).
-- Write: Admin only. This is the first real, machine-checked proof that
-- Super Admin is not a superset of Admin (Section 3.3).

CREATE POLICY college_select_active_or_staff ON app.college
  FOR SELECT TO authenticated
  USING (is_active = true OR app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY college_write_admin_only ON app.college
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY college_update_admin_only ON app.college
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY college_delete_admin_only ON app.college
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');

CREATE POLICY department_select_active_or_staff ON app.department
  FOR SELECT TO authenticated
  USING (is_active = true OR app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY department_write_admin_only ON app.department
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY department_update_admin_only ON app.department
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY department_delete_admin_only ON app.department
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');

CREATE POLICY course_select_active_or_staff ON app.course
  FOR SELECT TO authenticated
  USING (is_active = true OR app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY course_write_admin_only ON app.course
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY course_update_admin_only ON app.course
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY course_delete_admin_only ON app.course
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');

-- course_prerequisite has no is_active flag -- it's a relationship, not a
-- record with a lifecycle (Section 9.4.5: "hard delete is safe").
CREATE POLICY course_prerequisite_select_all ON app.course_prerequisite
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY course_prerequisite_write_admin_only ON app.course_prerequisite
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY course_prerequisite_delete_admin_only ON app.course_prerequisite
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');
