import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (EXEMPT_EXACT.has(pathname)) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Misconfigured environment -- every page that needs Supabase will
    // fail on its own with a clear error; nothing to enforce here yet.
    return NextResponse.next();
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
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in: let the destination page's own getCurrentActor()/
  // requireActor() check handle the /login redirect, exactly as today.
  if (!user) return response;

  const row = await db.query.appUser.findFirst({ where: eq(appUser.id, user.id) });
  if (row?.mustChangePassword) {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
