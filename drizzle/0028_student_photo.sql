-- Student photographs.
--
-- A SEPARATE TABLE, not columns on app.student. Every student read in this
-- codebase goes through Drizzle's relational query builder, which selects
-- every column of the table it is reading -- so a bytea on app.student
-- would pull the image bytes into the Student Listing, the CSV export, the
-- grade sheet and the enrolment lookups, none of which want them. One
-- image per student, so the student id is the primary key and there is no
-- separate surrogate to keep in step.
--
-- Bytes in Postgres rather than object storage. Deliberate and discussed:
-- a few hundred students at a couple of hundred KB each is a trivial
-- amount of database, and it keeps the photo inside the same backup,
-- the same RLS and the same transaction as the record it belongs to. The
-- cost is that images ride along in pg_dump, which at this scale is the
-- cheaper half of the trade.
CREATE TABLE "app"."student_photo" (
  -- ON DELETE RESTRICT like every other reference in this schema: a photo
  -- is not a reason a student row can be deleted, and nothing in this
  -- system deletes students anyway.
  "student_id" uuid PRIMARY KEY NOT NULL
    REFERENCES "app"."student"("id") ON DELETE RESTRICT,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "data" bytea NOT NULL,
  "uploaded_by" uuid NOT NULL
    REFERENCES "app"."app_user"("id") ON DELETE RESTRICT,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- The three formats every browser this College's students actually use
  -- can display. Enums as CHECK, not native Postgres enums (Section 10.3).
  -- The service layer ALSO sniffs the leading bytes, because a content type
  -- is a claim made by whoever uploaded the file, not a fact about it.
  CONSTRAINT "student_photo_content_type_valid"
    CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),

  -- Belt and braces against the service layer's own 2 MB limit. A CHECK
  -- here is what makes the limit true of the data rather than merely true
  -- of the one code path that currently writes it.
  CONSTRAINT "student_photo_size_valid"
    CHECK ("byte_size" > 0 AND "byte_size" <= 2097152),

  -- The stored length must match the declared one, so byte_size can be
  -- trusted by anything reading it (the Content-Length on the serve route)
  -- without re-measuring the blob.
  CONSTRAINT "student_photo_size_matches_data"
    CHECK ("byte_size" = octet_length("data"))
);
--> statement-breakpoint

-- Reads go through asUser()/RLS exactly like app.student itself, so the
-- "one student cannot fetch another student's photo" boundary is Postgres's
-- and not a service-layer if-statement. Writes use the superuser connection
-- behind an assertCan gate plus an audit record, the same DEV-03 pattern as
-- every other student write.
GRANT SELECT ON app.student_photo TO authenticated;
GRANT ALL ON app.student_photo TO service_role;

ALTER TABLE app.student_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student_photo FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Mirrors student_select_own / student_select_staff on app.student. A photo
-- is no more and no less private than the record it hangs off.
CREATE POLICY student_photo_select_own ON app.student_photo
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());
--> statement-breakpoint

CREATE POLICY student_photo_select_staff ON app.student_photo
  FOR SELECT TO authenticated
  USING (app.current_user_role() IN ('ADMIN', 'SUPER_ADMIN'));
