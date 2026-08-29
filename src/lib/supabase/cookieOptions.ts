/**
 * Security self-review finding (Stage 11, plan §18 REQUIRED control:
 * "Session: HttpOnly, Secure, SameSite=Lax session cookie"). @supabase/ssr's
 * own default (DEFAULT_COOKIE_OPTIONS in its constants.js) is
 * `httpOnly: false` and a 400-day maxAge -- neither matches the plan's
 * requirement, and nothing in this codebase overrode them until now. The
 * app has no client-side Supabase usage anywhere (no createBrowserClient,
 * no @supabase/supabase-js import in any .tsx file) -- every read and
 * write goes through a Server Component, Server Action, or this proxy --
 * so httpOnly:true has zero functional cost here, only upside.
 *
 * Shared between src/lib/supabase/server.ts and src/proxy.ts so both
 * code paths that can set this cookie agree on its flags; passing
 * different `cookieOptions` from two places that write the same cookie
 * would be its own bug.
 *
 * maxAge is shortened from the 400-day default to 12 hours as a
 * reasonable baseline (§18 RECOMMENDED: "Session lifetime and idle
 * timeout"). It is NOT role-differentiated (shorter for Admin/Super
 * Admin than Student, as the plan recommends) -- Supabase Auth's actual
 * token expiry is a per-project dashboard setting, not something this
 * codebase configures, and per-role enforcement would need additional
 * logic (comparing token issued-at against a role-keyed threshold) that
 * has not been built. Recorded as a partial step, not a full
 * implementation of that recommendation.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  // Not hardcoded true: `next dev` serves plain HTTP, and a Secure cookie
  // set over HTTP is silently dropped by the browser outside the special
  // case of exactly "localhost" -- which would break login for anyone
  // developing against a non-localhost dev host (Docker network alias,
  // LAN IP). Real deployments (Vercel or any HTTPS-terminating host) run
  // with NODE_ENV=production, where this is true, matching §18's actual
  // requirement.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 12 * 60 * 60,
  path: "/",
};
