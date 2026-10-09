-- =====================================================================
--  RESET THE DEMO between runs: Hawa Kromah Demo (2026999)
--
--  Removes only what the demo itself created for this one student:
--  her course plan(s), plan items and registrations for the semester
--  you planned in. Her account and her 3 semesters of past grades stay,
--  so the demo can be repeated from "she has not planned yet".
--
--  Run in the Supabase SQL Editor. Safe to run any number of times.
-- =====================================================================
do $reset$
declare
  v_id uuid;
  n_items int; n_plans int; n_regs int;
begin
  select id into v_id from app.app_user where login_identifier = '2026999';
  if v_id is null then raise exception 'Student 2026999 does not exist. Run create-demo-student-2026999.sql first.'; end if;

  delete from app.course_plan_item where plan_id in (select id from app.course_plan where student_id = v_id);
  get diagnostics n_items = row_count;
  delete from app.course_plan where student_id = v_id;
  get diagnostics n_plans = row_count;
  -- registrations made by an approved plan (never one that already has a grade)
  delete from app.registration r
   where r.student_id = v_id
     and not exists (select 1 from app.grade_record g where g.registration_id = r.id);
  get diagnostics n_regs = row_count;

  raise notice 'Reset done: % plan(s), % plan item(s), % registration(s) removed. Past grades untouched.', n_plans, n_items, n_regs;
end
$reset$;
