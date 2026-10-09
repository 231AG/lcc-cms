-- =====================================================================
--  DEMO STUDENT:  Hawa Kromah Demo  ·  ID 2026999  ·  Public Administration
--
--  Creates, in one go:
--    * the sign-in account  (Student ID 2026999 / password below)
--    * the student record in Public Administration
--    * 3 semesters of past grades (the 3 most recent CLOSED semesters,
--      5 courses each) with correct GPA and CGPA
--    * NO course plan, so planning for the open semester starts from zero
--
--  HOW TO RUN: Supabase dashboard -> SQL Editor -> paste ALL of it -> Run.
--  It is all-or-nothing: if anything is missing it stops with a message and
--  changes nothing. Run it ONCE. To run the demo again, use
--  reset-demo-student-2026999.sql instead.
-- =====================================================================
do $demo$
declare
  v_student_no constant text := '2026999';
  v_first      constant text := 'Hawa';
  v_last       constant text := 'Kromah Demo';
  v_major      constant text := 'Public Administration';
  v_password   constant text := 'hawa2026';          -- sign-in password for the demo
  v_email      constant text := v_student_no || '@students.lcc-eportal.invalid';

  v_id      uuid := gen_random_uuid();
  v_dept    uuid;
  v_creator uuid;
  v_policy  int;
  v_sems    uuid[];
  v_n_major int;
  v_n       int;
  letters   constant text[] := array['A-','B+','A+','B-','A-',  'B+','A-','A+','B+','A-',  'A+','A-','B+','A+','A-'];
begin
  -- pgcrypto lives in "extensions" on Supabase
  perform set_config('search_path', 'extensions, public, pg_catalog', true);

  -- ---- checks (nothing has been written yet) -------------------------
  if exists (select 1 from app.app_user where login_identifier = v_student_no)
     or exists (select 1 from auth.users where email = v_email) then
    raise exception 'Student % already exists. Run reset-demo-student-2026999.sql first.', v_student_no;
  end if;

  select d.id into v_dept from app.department d
   where d.name ilike '%' || v_major || '%'
   order by d.is_active desc, length(d.name) limit 1;
  if v_dept is null then
    raise exception 'No department matching "%". Departments found: %', v_major,
      (select string_agg(name, ', ' order by name) from app.department);
  end if;

  select id into v_creator from app.app_user
   where role in ('SUPER_ADMIN','ADMIN') and status = 'ACTIVE'
   order by (role = 'SUPER_ADMIN') desc, created_at limit 1;
  if v_creator is null then raise exception 'No active Admin or Super Admin account found.'; end if;

  select max(policy_version) into v_policy from app.grade_scale where effective_from <= now();

  select array_agg(x.id order by x.start_date, x.sequence) into v_sems from (
    select s.id, s.sequence, ay.start_date
      from app.semester s join app.academic_year ay on ay.id = s.academic_year_id
     where s.state = 'CLOSED'
     order by ay.start_date desc, s.sequence desc limit 3) x;
  if coalesce(array_length(v_sems, 1), 0) < 3 then
    raise exception 'Need at least 3 CLOSED semesters for past grades; found %.', coalesce(array_length(v_sems, 1), 0);
  end if;

  -- 15 courses: Public Administration first, then others; never a course that is
  -- offered this term (so the student can still plan it).
  create temp table demo_pick on commit drop as
  select row_number() over (order by (c.department_id = v_dept) desc, c.code) as n,
         c.id, c.code, c.title, c.credit_hours, c.department_id
    from app.course c
   where c.is_active
     and not exists (select 1 from app.course_offering o join app.semester s on s.id = o.semester_id
                      where o.course_id = c.id and s.state in ('OPEN','IN_PROGRESS'))
   order by 1 limit 15;
  -- split the chosen courses into 3 equal groups, one per semester
  create temp table demo_final on commit drop as
  select row_number() over (order by n) as n, ntile(3) over (order by n) as sem_ix,
         id, code, title, credit_hours, department_id from demo_pick;
  select count(*), count(*) filter (where department_id = v_dept) into v_n, v_n_major from demo_final;
  if v_n < 9 then raise exception 'Only % usable courses in the catalogue; need at least 9.', v_n; end if;

  -- ---- sign-in account ----------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(v_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  insert into app.app_user (id, login_identifier, display_name, role, status, must_change_password, created_by)
  values (v_id, v_student_no, v_first || ' ' || v_last, 'STUDENT', 'ACTIVE', false, v_creator);

  -- ---- student record -----------------------------------------------
  insert into app.student (id, student_number, first_name, last_name, gender, department_id, enrolment_year,
                           status, historical_import_status, import_completed_by, import_completed_at, created_by,
                           country_of_origin, county_of_origin, degree)
  values (v_id, v_student_no, v_first, v_last, 'FEMALE', v_dept, 2026,
          'ACTIVE', 'COMPLETE', v_creator, now(), v_creator,
          'Liberia', 'Montserrado', 'BA');

  -- ---- past grades: 5 courses in each of the 3 semesters ---------------
  insert into app.academic_record (student_id, semester_id, course_id, course_code_snapshot, course_title_snapshot,
                                   credit_hours, letter, grade_point, attempt_no, origin,
                                   counts_in_gpa, counts_in_attempted, counts_in_earned,
                                   was_major_at_record, entered_by, source_note)
  select v_id, v_sems[p.sem_ix], p.id, p.code, p.title, p.credit_hours,
         g.letter, g.grade_point, 1, 'IMPORTED',
         g.counts_in_gpa, g.counts_in_attempted, g.counts_in_earned,
         (p.department_id = v_dept), v_creator, 'Demo account record'
    from demo_final p
    join app.grade_scale g on g.letter = letters[p.n::int] and g.policy_version = v_policy
   ;

  -- ---- GPA summaries (same arithmetic as the application) ---------------
  insert into app.student_semester_summary (student_id, semester_id, gpa, credits_attempted, credits_earned, is_provisional, policy_version)
  select student_id, semester_id,
         round(sum(grade_point * credit_hours) filter (where counts_in_gpa)
               / nullif(sum(credit_hours) filter (where counts_in_gpa), 0), 6),
         coalesce(sum(credit_hours) filter (where counts_in_attempted), 0),
         coalesce(sum(credit_hours) filter (where counts_in_earned), 0),
         false, v_policy
    from app.academic_record where student_id = v_id and not is_void
   group by student_id, semester_id;

  insert into app.student_cumulative_summary (student_id, cgpa, total_credits_attempted, total_credits_earned, is_provisional, policy_version)
  select student_id,
         round(sum(grade_point * credit_hours) filter (where counts_in_gpa)
               / nullif(sum(credit_hours) filter (where counts_in_gpa), 0), 6),
         coalesce(sum(credit_hours) filter (where counts_in_attempted), 0),
         coalesce(sum(credit_hours) filter (where counts_in_earned), 0),
         false, v_policy
    from app.academic_record where student_id = v_id and not is_void
   group by student_id;

  raise notice '--- DONE ---------------------------------------------------';
  raise notice 'Sign in:  Student ID % / password %', v_student_no, v_password;
  raise notice 'Past grades: % courses over 3 semesters (% in %)', v_n, v_n_major, v_major;
  raise notice 'Semesters open for planning: %',
    coalesce((select string_agg(ay.label || ' ' || s.name, ', ') from app.semester s
               join app.academic_year ay on ay.id = s.academic_year_id where s.state = 'OPEN'),
             'NONE - open one in Academic calendar (Draft -> Open) before the demo, or planning will say it is not open');
  raise notice 'Published offerings in %: %', v_major,
    (select count(*) from app.course_offering o join app.course c on c.id = o.course_id
       join app.semester s on s.id = o.semester_id
      where s.state = 'OPEN' and o.status = 'PUBLISHED' and c.department_id = v_dept);
end
$demo$;

-- Check it (read-only): one row per past semester, then the totals
select ay.label || ' ' || s.name as semester, ss.gpa, ss.credits_attempted, ss.credits_earned
  from app.student_semester_summary ss
  join app.semester s on s.id = ss.semester_id
  join app.academic_year ay on ay.id = s.academic_year_id
 where ss.student_id = (select id from app.app_user where login_identifier = '2026999')
 order by ay.start_date, s.sequence;
select cgpa, total_credits_attempted, total_credits_earned
  from app.student_cumulative_summary
 where student_id = (select id from app.app_user where login_identifier = '2026999');
