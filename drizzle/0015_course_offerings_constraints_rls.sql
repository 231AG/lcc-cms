-- Stage 8: course_offering/offering_meeting uniqueness, grants, and RLS
-- (Section 9.4.7/9.4.8, 10.5, 12.4).

-- Section identifiers recur every semester by design (Section 12.4
-- Structural Rule #6: "'A' recurs every semester; that is expected, not a
-- duplicate") -- uniqueness is scoped to (semester, course), not global.
CREATE UNIQUE INDEX course_offering_unique_section_idx
  ON app.course_offering (semester_id, course_id, lower(trim(section)));

CREATE INDEX course_offering_semester_idx ON app.course_offering (semester_id);
CREATE INDEX offering_meeting_offering_idx ON app.offering_meeting (offering_id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON app.course_offering, app.offering_meeting TO authenticated;
GRANT ALL ON app.course_offering, app.offering_meeting TO service_role;

ALTER TABLE app.course_offering ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course_offering FORCE ROW LEVEL SECURITY;
ALTER TABLE app.offering_meeting ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.offering_meeting FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Read: a student sees only PUBLISHED offerings ("active rows only",
-- Section 10.5) -- DRAFT offerings are being set up and CANCELLED ones
-- never happened as far as a student is concerned. Admin/Super Admin see
-- everything, matching every other structural table.
-- Write: Admin only (REQ-R04 explicitly denies Super Admin) -- state
-- gating (a Closed semester refuses new/edited offerings) is a service-
-- layer concern, not something RLS can see without a cross-table lookup
-- at every write, so it lives in the service layer per DEV-03's pattern.

CREATE POLICY course_offering_select_published_or_staff ON app.course_offering
  FOR SELECT TO authenticated
  USING (status = 'PUBLISHED' OR app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));

CREATE POLICY course_offering_write_admin_only ON app.course_offering
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY course_offering_update_admin_only ON app.course_offering
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY course_offering_delete_admin_only ON app.course_offering
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');

-- offering_meeting has no status of its own -- visibility follows its
-- parent offering's PUBLISHED status.
CREATE POLICY offering_meeting_select_published_or_staff ON app.offering_meeting
  FOR SELECT TO authenticated
  USING (
    app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN')
    OR EXISTS (
      SELECT 1 FROM app.course_offering co
      WHERE co.id = offering_meeting.offering_id AND co.status = 'PUBLISHED'
    )
  );

CREATE POLICY offering_meeting_write_admin_only ON app.offering_meeting
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY offering_meeting_update_admin_only ON app.offering_meeting
  FOR UPDATE TO authenticated
  USING (app.current_user_role() = 'ADMIN')
  WITH CHECK (app.current_user_role() = 'ADMIN');
CREATE POLICY offering_meeting_delete_admin_only ON app.offering_meeting
  FOR DELETE TO authenticated
  USING (app.current_user_role() = 'ADMIN');
