import Link from "next/link";
import Image from "next/image";
import { ChevronDown, LogOut, KeyRound, Menu } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { navGroupsForRole } from "./navLinks";
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
  const groups = actor ? navGroupsForRole(actor.role) : [];
  const hasLinks = groups.some((g) => g.links.length > 0);

  return (
    <header className="print:hidden bg-brand-900 text-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center justify-between gap-4">
          <Link href={actor ? "/portal" : "/login"} className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-0.5">
              <Image src="/lcc-logo.png" alt="" width={28} height={32} className="h-full w-full object-contain" priority />
            </span>
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

        {actor && !actor.mustChangePassword && hasLinks && (
          <nav aria-label="Main" className="pb-2 text-sm">
            {/* Desktop: unlabeled groups render inline, labeled groups as a
                click-to-open dropdown (native <details>, no client JS --
                same disclosure pattern already used elsewhere in the app).
                A shared `name` makes same-level dropdowns mutually
                exclusive in browsers that support it; harmless where they
                don't. */}
            <div className="hidden flex-wrap items-center gap-1 md:flex">
              {groups.map((group) =>
                group.label ? (
                  <details key={group.label} name="main-nav" className="group relative">
                    <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-3 py-1.5 text-brand-100 marker:content-none hover:bg-brand-800 hover:text-white group-open:bg-brand-800 group-open:text-white">
                      {group.label}
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="absolute left-0 z-20 mt-1 min-w-56 rounded-lg border border-neutral-200 bg-white p-1.5 text-neutral-700 shadow-lg">
                      {group.links.map((link) => (
                        <Link key={link.href} href={link.href} className="block rounded-md px-3 py-2 hover:bg-brand-50 hover:text-brand-800">
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </details>
                ) : (
                  group.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="whitespace-nowrap rounded-md px-3 py-1.5 text-brand-100 hover:bg-brand-800 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  ))
                ),
              )}
            </div>

            {/* Mobile: one hamburger panel, every group listed vertically. */}
            <details className="md:hidden">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-1.5 text-brand-100 marker:content-none hover:bg-brand-800 hover:text-white">
                <Menu className="h-4 w-4" aria-hidden="true" />
                Menu
              </summary>
              <div className="mt-1 flex flex-col gap-3 rounded-lg bg-brand-800 p-3">
                {groups.map((group, i) => (
                  <div key={group.label || i} className="flex flex-col gap-0.5">
                    {group.label && <p className="px-3 text-xs font-semibold tracking-wide text-brand-300 uppercase">{group.label}</p>}
                    {group.links.map((link) => (
                      <Link key={link.href} href={link.href} className="rounded-md px-3 py-1.5 text-brand-100 hover:bg-brand-700 hover:text-white">
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </nav>
        )}
      </div>
    </header>
  );
}
