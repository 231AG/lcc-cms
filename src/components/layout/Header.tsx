import Link from "next/link";
import Image from "next/image";
import { LogOut, KeyRound } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { navGroupsForRole } from "./navLinks";
import { signOutAction } from "@/app/actions";
import { MainNav } from "./MainNav";
import { navItem } from "./navStyles";
import { ThemeToggle } from "./ThemeToggle";

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
 *
 * The bar itself is a neutral surface rather than a solid brand fill, with
 * Deep Orchid reserved for the wordmark, hover text and the gradient hairline
 * -- a full-width saturated purple band is exactly the "large bright-purple
 * section" the dark theme is meant to avoid. The theme toggle sits outside the
 * `actor` branch so it is available to every role and to signed-out visitors.
 *
 * The links themselves live in MainNav, the one client component in this
 * shell: menu open/closed state and "which item is current" both depend on
 * the route the user is actually on, which a shared layout cannot see after
 * a client navigation. See the comment at the top of MainNav.tsx.
 */
export function Header({ actor }: { actor: Actor | null }) {
  const groups = actor ? navGroupsForRole(actor.role) : [];
  const hasLinks = groups.some((g) => g.links.length > 0);

  return (
    <header className="print:hidden border-b border-line bg-surface text-fg">
      {/* The one Deep Orchid -> Lavender Haze gradient in the app chrome:
          contained to a hairline so the brand reads at a glance without a
          large saturated fill. */}
      <div className="bg-gradient-brand h-1" aria-hidden="true" />
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center justify-between gap-4">
          <Link
            href={actor ? "/portal" : "/login"}
            className="flex items-center gap-2 font-semibold tracking-tight text-fg"
          >
            <span className="bg-seal-backdrop flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line p-0.5">
              <Image src="/lcc-logo.png" alt="" width={28} height={32} className="h-full w-full object-contain" priority />
            </span>
            <span>Liberia Christian College</span>
            <span className="hidden text-brand-fg sm:inline">E-Portal</span>
          </Link>

          <div className="flex items-center gap-1 text-sm sm:gap-2">
            {actor && (
              <span className="hidden text-fg-secondary sm:inline">
                {actor.displayName} <span className="text-fg-muted">&middot;</span> {ROLE_LABEL[actor.role]}
              </span>
            )}
            <ThemeToggle />
            {actor && (
              <>
                <Link href="/change-password" className={`${navItem} flex items-center gap-1.5 px-2`}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Change password</span>
                </Link>
                <form action={signOutAction}>
                  <button type="submit" className={`${navItem} flex items-center gap-1.5 px-2`}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {actor && !actor.mustChangePassword && hasLinks && <MainNav groups={groups} />}
      </div>
    </header>
  );
}
