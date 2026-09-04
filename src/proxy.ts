import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookieOptions";

/**
 * Security self-review finding (Stage 11, plan §18 REQUIRED control:
 * "Forced first-login password change ... unbypassable by direct URL",
 * REQ-A03/DER-04). Before this file existed, the must-change-password
 * redirect was implemented per-page (checked in /portal and /planning
 * only) -- every other route added since Stage 3 (accounts, structure,
 * calendar, offerings, students, grades, grade-review, grade-corrections,
 * historical, registrations, export, audit, grading-policy) had no such
 * check at all, so a user who never completed their forced first change
 * could reach and use any of them by typing the URL directly. This proxy
 * (Next.js 16 renamed "middleware" to "proxy"; it defaults to the Node.js
 * runtime, which is what makes a real DB-backed check possible here)
 * closes that gap centrally, once, instead of requiring every future page
 * to remember to add its own copy of the same three lines.
 *
 * Deliberately narrow: this checks exactly one thing (must_change_password)
 * for exactly one purpose (the plan's own stated requirement). It does not
 * attempt session invalidation on account disable or other broader
 * auth-hardening -- out of scope for the finding being fixed here.
 */
const EXEMPT_EXACT = new Set(["/login", "/change-password"]);

/**
 * §18 RECOMMENDED: "Security headers -- Content-Security-Policy,
 * X-Content-Type-Options, Referrer-Policy, frame-ancestors deny." Applied
 * here (not next.config.ts) so every response this proxy touches --
 * including the redirect to /change-password -- carries them, with one
 * definition instead of two.
 *
 * script-src IS nonce-based as of the second performance pass -- see
 * buildCsp below for what forced that change. style-src still is not: a
 * few pages use inline `style` attributes for per-row dynamic values (the
 * A-16 import-progress bar chart), and a nonce cannot cover style
 * attributes. This app loads no third-party scripts or styles at all, so
 * what remains is 'unsafe-inline' for styles only, in an app whose threat
 * model the plan itself frames as "not a public-facing system with an
 * adversarial internet population" (§18). Recorded plainly rather than
 * claimed as stricter than it is.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // The nonce is what changed here, and why. `script-src 'self'` alone
    // blocks React's inline streaming scripts -- the tiny snippets it emits
    // to move Suspense content out of `<div hidden>` and into the document.
    // With no Suspense boundaries in the app, nothing noticed. The moment a
    // `loading.tsx` was added, every page under it rendered correctly and
    // then stayed permanently invisible, with "Executing inline script
    // violates ... 'script-src self'" in the console. Caught in a browser
    // during this performance pass, not in review.
    //
    // A per-request nonce (Next.js's documented approach: set it on the
    // REQUEST's CSP header and the framework applies it to its own script
    // tags) is strictly stronger than the alternative of adding
    // 'unsafe-inline', and unblocks streaming for good. Deliberately
    // WITHOUT 'strict-dynamic', which would make 'self' inert and is a
    // larger behavioural change than this gap requires.
    `script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Unchanged: style-src keeps 'unsafe-inline' because several pages use
    // inline `style` attributes for per-row dynamic values (the A-16
    // import-progress bar chart). A nonce cannot cover style ATTRIBUTES,
    // only style elements, so tightening this would need those rewritten
    // first -- out of scope here, and called out rather than glossed over.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

/**
 * A request carrying no Supabase auth cookie at all cannot have a session,
 * so `supabase.auth.getUser()` below would return null and this proxy would
 * do nothing -- after a network round trip to the Auth API and a database
 * query. Short-circuiting is therefore behaviour-preserving, not a relaxed
 * check: no cookie, no session, nothing to enforce. It matters because this
 * proxy runs on EVERY request the matcher admits, including each RSC
 * payload fetch and every static-ish asset that isn't excluded.
 */
function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A fresh nonce per request -- an attacker guessing it is the whole
  // threat model of a nonce, so it must never be reused or derived from
  // anything predictable. Passed to the renderer via the REQUEST's own CSP
  // header, which is where Next.js looks for it.
  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  const nextWithNonce = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (EXEMPT_EXACT.has(pathname)) {
    return withSecurityHeaders(nextWithNonce(), csp);
  }

  if (!hasSupabaseAuthCookie(request)) {
    return withSecurityHeaders(nextWithNonce(), csp);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Misconfigured environment -- every page that needs Supabase will
    // fail on its own with a clear error; nothing to enforce here yet.
    return withSecurityHeaders(nextWithNonce(), csp);
  }

  let response = nextWithNonce();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Re-clone AFTER the cookie writes so the refreshed session rides
        // along, and re-apply the CSP header -- rebuilding from `request`
        // alone would drop the nonce and silently reinstate the blocked-
        // inline-script bug on exactly the requests that refresh a token.
        const refreshed = new Headers(request.headers);
        refreshed.set("Content-Security-Policy", csp);
        response = NextResponse.next({ request: { headers: refreshed } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });

  // `getClaims()` rather than `getUser()`: this project signs its JWTs with
  // ES256 (asymmetric), so getClaims verifies the signature and expiry
  // locally against the cached JWKS -- measured at ~1ms against ~397ms for
  // getUser(), which calls the Auth API over the network on every single
  // request this proxy sees.
  //
  // Why that is safe HERE specifically: this proxy is not the
  // authorization boundary. It decides one thing (redirect to
  // /change-password), from a cryptographically verified subject, against
  // a live database read. The page behind it still runs the full
  // getCurrentActor() -- a real getUser() plus an app_user status check --
  // so a revoked or disabled session is refused there exactly as before.
  // Nothing that was previously enforced stops being enforced.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  // Not signed in: let the destination page's own getCurrentActor()/
  // requireActor() check handle the /login redirect, exactly as today.
  if (!userId) return withSecurityHeaders(response, csp);

  // One column, not the whole row: this runs on every authenticated
  // request and the only thing it decides is the redirect below.
  const [row] = await db
    .select({ mustChangePassword: appUser.mustChangePassword })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  if (row?.mustChangePassword) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/change-password", request.url)), csp);
  }

  return withSecurityHeaders(response, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
