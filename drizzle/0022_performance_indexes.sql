-- Performance pass: three indexes that should have existed all along.
--
-- None of these is a current bottleneck -- the tables are small today (178
-- courses, 83 departments, 158 students) and Postgres will happily
-- sequential-scan them. They are here because every one of these columns is
-- either a foreign key that gets joined and filtered on, or the default
-- sort order of a paginated list, and adding them later against a table
-- with real volume is a lock-and-wait problem rather than an instant one.
--
-- Recorded honestly rather than claimed as a speedup: the measured wins in
-- this pass came from removing round trips (see DEV-21), not from these.

-- course.department_id: joined on every Academic Structure render and
-- filtered whenever courses are listed for one department. Postgres does
-- not create an index for a foreign key automatically.
CREATE INDEX IF NOT EXISTS course_department_idx ON app.course (department_id);
--> statement-breakpoint

-- department.college_id: same reason, one level up.
CREATE INDEX IF NOT EXISTS department_college_idx ON app.department (college_id);
--> statement-breakpoint

-- student (last_name, first_name): the ORDER BY behind searchStudents,
-- which is the paginated query the Students page runs on every load. With
-- an index the LIMIT/OFFSET can walk it in order instead of sorting the
-- whole matching set each time.
CREATE INDEX IF NOT EXISTS student_name_idx ON app.student (last_name, first_name);
