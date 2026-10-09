-- =====================================================================
--  REMOVE THE DEMO STUDENT COMPLETELY: Hawa Kromah Demo (2026999)
--
--  Deletes only rows that belong to this one student.
--  If the demo left entries in the audit log under her name (the audit log
--  can never be edited), she cannot be deleted; the script then DISABLES
--  the account instead and says so.
-- =====================================================================
do $remove$
declare
  v_id uuid;
begin
  select id into v_id from app.app_user where login_identifier = '2026999';
  if v_id is null then raise notice 'Student 2026999 does not exist. Nothing to do.'; return; end if;

  delete from app.course_plan_item where plan_id in (select id from app.course_plan where student_id = v_id);
  delete from app.course_plan where student_id = v_id;
  delete from app.registration r where r.student_id = v_id
     and not exists (select 1 from app.grade_record g where g.registration_id = r.id);

  if exists (select 1 from audit.audit_log where actor_user_id = v_id)
     or exists (select 1 from app.registration where student_id = v_id) then
    update app.app_user set status = 'DISABLED' where id = v_id;
    update app.student  set status = 'INACTIVE' where id = v_id;
    raise notice 'She has audit-log entries, so she was DISABLED (cannot sign in) instead of deleted.';
    return;
  end if;

  delete from app.student_photo where student_id = v_id;
  delete from app.student_semester_summary where student_id = v_id;
  delete from app.student_cumulative_summary where student_id = v_id;
  delete from app.academic_record where student_id = v_id;
  delete from app.student where id = v_id;
  delete from app.app_user where id = v_id;
  delete from auth.identities where user_id = v_id;
  delete from auth.users where id = v_id;
  raise notice 'Student 2026999 removed completely.';
end
$remove$;
