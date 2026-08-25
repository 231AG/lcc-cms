-- Stage 2: identity constraints, invariants, and RLS (Section 9.4.1, 11, 22.3).

-- Local-dev-only shim: a plain Postgres instance (Docker) has no `auth`
-- schema. This creates a minimal `auth.uid()` reading the same session
-- variable Supabase's real implementation reads, so RLS policies written
-- against auth.uid() are testable locally. Guarded to only fire when
-- auth.uid() does not already exist, so this is a complete no-op against a
-- real Supabase project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $fn$;
    -- Real Supabase projects already grant these; only needed for the
    -- locally-created shim, so this stays inside the guarded branch.
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role';
  END IF;
END
$$;
--> statement-breakpoint

-- Enumerations as CHECK constraints, not native enums (Section 10.3): the
-- role/status vocab is small and stable enough here that this is mostly
-- belt-and-suspenders, but it keeps the pattern consistent for later tables
-- (student status, grade letters) where pending decisions make it matter.
ALTER TABLE app.app_user ADD CONSTRAINT app_user_role_check
  CHECK (role IN ('STUDENT', 'ADMIN', 'SUPER_ADMIN'));
ALTER TABLE app.app_user ADD CONSTRAINT app_user_status_check
  CHECK (status IN ('ACTIVE', 'DISABLED'));
ALTER TABLE app.permission ADD CONSTRAINT permission_role_check
  CHECK (role IN ('STUDENT', 'ADMIN', 'SUPER_ADMIN'));
--> statement-breakpoint

-- login_identifier is globally unique, case-insensitive (Section 9.4.1).
CREATE UNIQUE INDEX app_user_login_identifier_unique_idx
  ON app.app_user (lower(trim(login_identifier)));
--> statement-breakpoint

-- Foreign keys, all RESTRICT (Section 10.4): no cascading delete anywhere
-- in this database. app_user is never hard-deleted in normal operation, so
-- RESTRICT is a safety net, not an expected failure mode.
ALTER TABLE app.app_user ADD CONSTRAINT app_user_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.app_user(id) ON DELETE RESTRICT;
ALTER TABLE audit.audit_log ADD CONSTRAINT audit_log_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES app.app_user(id) ON DELETE RESTRICT;
ALTER TABLE app.idempotency_key ADD CONSTRAINT idempotency_key_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES app.app_user(id) ON DELETE RESTRICT;
ALTER TABLE app.institution_setting ADD CONSTRAINT institution_setting_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES app.app_user(id) ON DELETE RESTRICT;
--> statement-breakpoint

-- Role is immutable after creation (Section 11.4 hard constraint): changing
-- what someone may do means disabling one account and creating another, so
-- audit attribution stays truthful. Enforced here too, not only in the
-- service layer.
CREATE OR REPLACE FUNCTION app.enforce_role_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.role <> OLD.role THEN
    RAISE EXCEPTION 'app_user.role is immutable; disable this account and create a new one instead';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER app_user_role_immutable
  BEFORE UPDATE ON app.app_user
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_role_immutable();
--> statement-breakpoint

-- Invariant I-11: at least one ACTIVE Super Admin must exist at all times.
-- Statement-level so the aggregate check runs once after the whole
-- statement's effect is applied, not once per row. Never fires on INSERT,
-- so the bootstrap procedure's very first row is unaffected.
CREATE OR REPLACE FUNCTION app.enforce_min_one_super_admin() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.app_user WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'At least one active Super Admin must exist at all times';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER app_user_min_super_admin
  AFTER UPDATE OR DELETE ON app.app_user
  FOR EACH STATEMENT
  EXECUTE FUNCTION app.enforce_min_one_super_admin();
--> statement-breakpoint

-- Helper used by RLS policies below: the acting user's own role.
-- MUST be SECURITY DEFINER. Without it, evaluating this function while
-- checking app_user's own RLS policies (which call this function) makes
-- Postgres re-evaluate those same policies to read the row this function
-- needs, which calls this function again -- infinite recursion ("stack
-- depth limit exceeded"), caught by hand while testing this migration.
-- SECURITY DEFINER runs as the function's owner (postgres, a superuser,
-- created via migration), which bypasses RLS entirely for this one lookup.
-- search_path is pinned to prevent search-path hijacking of a definer
-- function, per Postgres's own security advice for SECURITY DEFINER.
CREATE OR REPLACE FUNCTION app.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_temp
AS $fn$
  SELECT role FROM app.app_user WHERE id = auth.uid()
$fn$;
--> statement-breakpoint

GRANT SELECT ON app.app_user, app.permission TO authenticated;
GRANT ALL ON app.app_user, app.permission TO service_role;

ALTER TABLE app.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE app.permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permission FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- app_user: no INSERT/UPDATE/DELETE policy for `authenticated` at all --
-- account creation goes through the Supabase Admin API (to create the
-- underlying auth user) and is written server-side via service_role, which
-- bypasses RLS. RLS here governs reads only (REQ-A05's "database policies"
-- half), which is where an accidental cross-student leak would actually
-- show up.
CREATE POLICY app_user_select_own ON app.app_user
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY app_user_select_admin_sees_students ON app.app_user
  FOR SELECT TO authenticated
  USING (app.current_user_role() = 'ADMIN' AND role = 'STUDENT');

CREATE POLICY app_user_select_super_admin_sees_all ON app.app_user
  FOR SELECT TO authenticated
  USING (app.current_user_role() = 'SUPER_ADMIN');

-- permission: reference data every authenticated session may read (the
-- service layer running on a user's behalf needs it too); writes reserved
-- to service_role.
CREATE POLICY permission_select_authenticated ON app.permission
  FOR SELECT TO authenticated
  USING (true);
