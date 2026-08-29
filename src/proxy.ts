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
 * The CSP is deliberately not nonce-based: a couple of existing pages
 * (e.g. the A-16 import-progress bar chart) use inline `style` attributes
 * for per-row dynamic values, and this app loads no third-party scripts
 * or styles at all -- 'self'-only script-src plus 'unsafe-inline' for
 * style-src is the honest, pragmatic middle ground for an institutional
 * app with this threat model (plan §18's own framing: "not a public-
 * facing system with an adversarial internet population"), not a
 * strict/nonce-based CSP. Recorded plainly rather than claimed as
 * stricter than it is.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (EXEMPT_EXACT.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Misconfigured environment -- every page that needs Supabase will
    // fail on its own with a clear error; nothing to enforce here yet.
    return withSecurityHeaders(NextResponse.next());
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in: let the destination page's own getCurrentActor()/
  // requireActor() check handle the /login redirect, exactly as today.
  if (!user) return withSecurityHeaders(response);

  const row = await db.query.appUser.findFirst({ where: eq(appUser.id, user.id) });
  if (row?.mustChangePassword) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/change-password", request.url)));
  }

  return withSecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
