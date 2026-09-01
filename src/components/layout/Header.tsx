import Link from "next/link";
import { GraduationCap, LogOut, KeyRound } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { navLinksForRole } from "./navLinks";
import { signOutAction } from "@/app/actions";

const ROLE_LABEL: Record<Actor["role"], string> = {
  STUDENT: "Student",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

/**
 * The persistent header/nav the app never had (every page used to be a
 * lone `<main>` with no shell at all -- the brief's single highest-impact
 * change). Server Component: takes the already-resolved actor from the
 * root layout rather than re-querying, so it costs nothing extra per
 * request. Shows no nav links while a forced password change is pending
 * (every other route redirects there anyway, per src/proxy.ts), and no
 * nav/account controls at all when signed out (public pages).
 */
export function Header({ actor }: { actor: Actor | null }) {
  const links = actor ? navLinksForRole(actor.role) : [];

  return (
    <header className="print:hidden bg-brand-900 text-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center justify-between gap-4">
          <Link href={actor ? "/portal" : "/login"} className="flex items-center gap-2 font-semibold tracking-tight">
            <GraduationCap className="h-5 w-5 text-brand-200" aria-hidden="true" />
            <span>Liberia Christian College</span>
            <span className="hidden text-brand-300 sm:inline">E-Portal</span>
          </Link>

          {actor && (
            <div className="flex items-center gap-2 text-sm sm:gap-4">
              <span className="hidden text-brand-100 sm:inline">
                {actor.displayName} <span className="text-brand-400">&middot;</span> {ROLE_LABEL[actor.role]}
              </span>
              <Link
                href="/change-password"
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-brand-100 hover:bg-brand-800 hover:text-white"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Change password</span>
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-brand-100 hover:bg-brand-800 hover:text-white"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {actor && !actor.mustChangePassword && links.length > 0 && (
          <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto pb-2 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-brand-100 hover:bg-brand-800 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
