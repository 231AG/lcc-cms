-- Stage 4: calendar uniqueness, grants, and RLS (Section 9.4.6, 10.5, 13).

CREATE UNIQUE INDEX academic_year_label_unique_idx ON app.academic_year (label);
CREATE UNIQUE INDEX semester_year_sequence_unique_idx ON app.semester (academic_year_id, sequence);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON app.academic_year, app.semester TO authenticated;
GRANT ALL ON app.academic_year, app.semester TO service_role;

ALTER TABLE app.academic_year ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.academic_year FORCE ROW LEVEL SECURITY;
ALTER TABLE app.semester ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.semester FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- academic_year carries no sensitive state of its own; read is open,
-- writes are Admin only (REQ-S04, REQ-R04 denies Super Admin).
CREATE POLICY academic_year_select_all ON app.academic_year
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY academic_year_write_admin_only ON app.academic_year
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY academic_year_update_admin_only ON app.academic_year
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY academic_year_delete_admin_only ON app.academic_year
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');

-- semester: a Draft semester is invisible to anyone but Admin/Super Admin
-- (Section 13.1, State 1 — "No student visibility of any kind"). Writes
-- are Admin only at the RLS layer -- Super Admin's backward/reopen
-- transitions are performed through the service-role connection instead
-- (Section 10.5's own note: "except the semester-state backward
-- transition, which the service performs under an explicitly elevated,
-- audited path"), because RLS cannot express "Super Admin may update this
-- column only for specific from/to state pairs" -- that check belongs in
-- the pure transition table (semesterStateMachine.ts), not in a policy.
CREATE POLICY semester_select_visible_or_staff ON app.semester
  FOR SELECT TO authenticated
  USING (state != 'DRAFT' OR app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY semester_write_admin_only ON app.semester
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY semester_update_admin_only ON app.semester
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
