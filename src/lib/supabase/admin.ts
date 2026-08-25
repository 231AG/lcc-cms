import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely and can create/manage
 * Auth users via the Admin API.
 *
 * Deliberately does NOT import the `server-only` package: that guard
 * throws unconditionally outside Next's own bundler (including in plain
 * Node -- it broke the bootstrap script and Playwright's setup/teardown
 * the first time this was wired up), so it adds friction for legitimate
 * server-side tooling without adding real protection. The actual guarantee
 * that matters is that SUPABASE_SERVICE_ROLE_KEY is never a NEXT_PUBLIC_*
 * variable, so Next.js has no path to inline it into a browser bundle
 * (plan Section 18: "no service-role key is ever sent to a browser") --
 * that holds regardless of which module happens to import this file.
 *
 * Use this ONLY for: creating/disabling app_user + Auth user pairs,
 * resetting passwords, the bootstrap procedure, and test setup/teardown.
 * Everything done on behalf of a logged-in user should go through the
 * request-scoped server client (server.ts) so RLS actually applies.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
