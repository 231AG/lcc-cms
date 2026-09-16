-- An Admin's override of a timetable clash, so a plan whose courses overlap
-- can still be approved.
--
-- Deliberately the same shape as the prerequisite override two columns
-- above it (prereq_override_reason / prereq_override_by, 0021): same
-- naming, same nullability, same "reason is required, and we record who".
-- One override mechanism with two subjects, rather than two mechanisms that
-- drift apart.
--
-- Why per ITEM and not per plan: a clash is between a PAIR of courses, and
-- an Admin overriding "BIOL 205 may overlap" should clear every pair that
-- course is in, without silently forgiving an unrelated clash elsewhere in
-- the same plan. The validator treats a pair as overridden when EITHER side
-- carries a reason.
--
-- IF NOT EXISTS on purpose: this migration may be applied by hand through
-- the Supabase SQL editor before `npm run db:migrate` next runs, and the
-- migrate step must then be a harmless no-op rather than an error. Nothing
-- else in the file depends on ordering, so re-running it is safe.
ALTER TABLE "app"."course_plan_item"
  ADD COLUMN IF NOT EXISTS "schedule_override_reason" text;

ALTER TABLE "app"."course_plan_item"
  ADD COLUMN IF NOT EXISTS "schedule_override_by" uuid;

-- Matches prereq_override_by: RESTRICT, so the staff member who made the
-- decision cannot be deleted out from under the record of it.
DO $$
BEGIN
  ALTER TABLE "app"."course_plan_item"
    ADD CONSTRAINT "course_plan_item_schedule_override_by_fkey"
    FOREIGN KEY ("schedule_override_by") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already applied
END
$$;
