import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SESSION_COOKIE_OPTIONS } from "./cookieOptions";

/**
 * Request-scoped Supabase client bound to the caller's session cookie.
 * Queries through this client run as the `authenticated` Postgres role with
 * `auth.uid()` resolving to the real signed-in user, so RLS is a genuine
 * second gate here -- not bypassed the way createAdminClient() is (plan
 * Section 8.1, principle P4: defence in depth on authorisation).
 *
 * Use this for anything done on behalf of a logged-in user. Use
 * createAdminClient() only for the small set of operations that must
 * bypass RLS (account creation/reset, bootstrap).
 */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example).",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component that can't set cookies (no
          // active response) -- safe to ignore as long as middleware also
          // refreshes the session, per @supabase/ssr's documented pattern.
        }
      },
    },
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });
}
