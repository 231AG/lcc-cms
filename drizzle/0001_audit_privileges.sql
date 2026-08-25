-- Stage 1: privilege boundaries and RLS scaffolding (DER-20, TEC-03).
--
-- Ensures the standard Supabase-style roles exist so local development
-- (plain Postgres) mirrors the privilege model a Supabase project provides
-- out of the box. This block is a no-op against a real Supabase project,
-- where these roles already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA audit TO authenticated, service_role;
--> statement-breakpoint

-- audit_log: append-only. INSERT only for authenticated and service_role;
-- no UPDATE and no DELETE grant exists for any application role. SELECT is
-- withheld here too — a Super Admin read policy is added once app_user and
-- roles exist (REQ-R08, Stage 2). Until then, only service_role can read it,
-- which is the safer default.
REVOKE ALL ON audit.audit_log FROM PUBLIC, anon, authenticated;
GRANT INSERT ON audit.audit_log TO authenticated, service_role;
GRANT SELECT ON audit.audit_log TO service_role;
GRANT USAGE ON SEQUENCE audit.audit_log_id_seq TO authenticated, service_role;

ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log FORCE ROW LEVEL SECURITY;

-- With RLS enabled and no policy, every command is default-denied for any
-- role that does not bypass RLS -- including INSERT. Appending an audit
-- entry is a structural action available to any authenticated request (the
-- audit service itself is trusted internal code); who may READ the log is
-- the access decision that matters (REQ-R08) and is added as its own policy
-- once app_user and roles exist in Stage 2.
CREATE POLICY audit_log_insert_any_authenticated ON audit.audit_log
  FOR INSERT TO authenticated, service_role
  WITH CHECK (true);
--> statement-breakpoint

-- Configuration tables: readable by any authenticated session (students and
-- staff alike need to read the grading scale and institution settings);
-- writes are reserved to service_role until the Admin-write services and
-- their permission checks exist (Stage 7+ for grade_scale specifically,
-- per Section 10.5's Super-Admin-approval recommendation).
REVOKE ALL ON app.institution_setting, app.grade_scale FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app.institution_setting, app.grade_scale TO authenticated;
GRANT ALL ON app.institution_setting, app.grade_scale TO service_role;

ALTER TABLE app.institution_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.grade_scale ENABLE ROW LEVEL SECURITY;

CREATE POLICY institution_setting_select_authenticated ON app.institution_setting
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY grade_scale_select_authenticated ON app.grade_scale
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint

-- idempotency_key: internal bookkeeping for the transaction wrapper only.
-- No application-facing role needs direct access; the server writes to it
-- exclusively via service_role.
REVOKE ALL ON app.idempotency_key FROM PUBLIC, anon, authenticated;
GRANT ALL ON app.idempotency_key TO service_role;

ALTER TABLE app.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_key FORCE ROW LEVEL SECURITY;
