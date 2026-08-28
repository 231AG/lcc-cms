-- Stage 9: course_plan/course_plan_item/registration uniqueness, grants,
-- and RLS (Section 9.4.9/9.4.10, 14.2).

-- "At most one non-superseded plan per (student, semester)" (Section
-- 9.4.9) is honoured by a single mutable row rather than by versioning
-- separate rows, so this is a plain uniqueness constraint.
CREATE UNIQUE INDEX course_plan_unique_student_semester_idx
  ON app.course_plan (student_id, semester_id);
CREATE INDEX course_plan_semester_idx ON app.course_plan (semester_id);
CREATE INDEX course_plan_status_idx ON app.course_plan (status);

-- REQ-P07.
CREATE UNIQUE INDEX course_plan_item_unique_plan_course_idx
  ON app.course_plan_item (plan_id, course_id);
CREATE INDEX course_plan_item_plan_idx ON app.course_plan_item (plan_id);
CREATE INDEX course_plan_item_offering_idx ON app.course_plan_item (offering_id);

CREATE UNIQUE INDEX registration_unique_student_offering_idx
  ON app.registration (student_id, offering_id);
CREATE INDEX registration_offering_idx ON app.registration (offering_id);
CREATE INDEX registration_student_idx ON app.registration (student_id);
CREATE INDEX registration_semester_idx ON app.registration (semester_id);
--> statement-breakpoint

-- Every write in this domain runs through the raw superuser connection
-- (DEV-03's pattern), the same as academic_record: the six validators
-- (V1-V7), the atomic approval transaction with its row-locked capacity
-- check, and direct registration/drop all need cross-student and
-- cross-table reads (another student's registration count against a
-- shared offering, a student's own academic_record for prerequisite
-- checking) that RLS cannot cleanly express as a per-row policy. RLS
-- here is read-only for authenticated -- no write policy at all.
GRANT SELECT ON app.course_plan, app.course_plan_item, app.registration TO authenticated;
GRANT ALL ON app.course_plan, app.course_plan_item, app.registration TO service_role;

ALTER TABLE app.course_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE app.course_plan_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course_plan_item FORCE ROW LEVEL SECURITY;
ALTER TABLE app.registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.registration FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- course_plan: a student sees only their own plan; Admin sees every plan
-- (the approval queue). Super Admin has no role in course planning at all
-- (Section 9.4.9 Ownership: "Super Admin has no role here at all") --
-- unlike every other structural table, this is NOT extended to Super
-- Admin read-only, so no policy branch exists for that role and a Super
-- Admin actor sees zero rows.
CREATE POLICY course_plan_select_own_or_admin ON app.course_plan
  FOR SELECT TO authenticated
  USING (
    app.current_user_role() = 'ADMIN'
    OR student_id = auth.uid()
  );

CREATE POLICY course_plan_item_select_own_or_admin ON app.course_plan_item
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app.course_plan cp
      WHERE cp.id = course_plan_item.plan_id
        AND (app.current_user_role() = 'ADMIN' OR cp.student_id = auth.uid())
    )
  );

-- registration: same shape -- a student sees only their own registrations
-- (their timetable), Admin sees everything (the class list), Super Admin
-- sees nothing (registration is squarely part of the planning/enrolment
-- domain Super Admin is refused, not the grading domain Super Admin owns
-- from Stage 10 onward).
CREATE POLICY registration_select_own_or_admin ON app.registration
  FOR SELECT TO authenticated
  USING (
    app.current_user_role() = 'ADMIN'
    OR student_id = auth.uid()
  );
