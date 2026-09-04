-- DEV-20: a course plan entered by an Admin on a student's behalf.
--
-- Some students have no Android phone and so cannot do their own course
-- planning in the app (Section 17.8's "year one" reality). An Admin can
-- now build and submit a plan for them, through the SAME validators and
-- into the SAME approval queue as a student-submitted plan.
--
-- The audit log already records who did it (actor_user_id +
-- actor_role_snapshot on COURSE_PLAN_SUBMITTED), but a reviewer looking
-- at the approval queue could not see it without querying audit. This
-- column puts the fact on the row itself: NULL means the student entered
-- their own plan (so every existing row is already correct and needs no
-- backfill); a value names the staff member who entered it for them.
--
-- Deliberately nullable with no default and no check constraint -- it is
-- a provenance marker, not a state, and nothing in the plan lifecycle
-- branches on it. RESTRICT on delete matches every other app_user
-- reference in this schema (reviewed_by, decided_by, prereq_override_by).

ALTER TABLE "app"."course_plan"
  ADD COLUMN "entered_by" uuid;
--> statement-breakpoint

ALTER TABLE "app"."course_plan"
  ADD CONSTRAINT "course_plan_entered_by_app_user_id_fk"
  FOREIGN KEY ("entered_by") REFERENCES "app"."app_user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- No RLS change: course_plan's policies are read-only for `authenticated`
-- (own-row for Student, all-rows for Admin, zero rows for Super Admin --
-- Section 9.4.9) and every write in this domain already runs through the
-- raw superuser connection per DEV-03's pattern. A student seeing this
-- column on their own plan is intended: it tells them the office entered
-- it for them.
CREATE INDEX course_plan_entered_by_idx ON app.course_plan (entered_by) WHERE entered_by IS NOT NULL;
