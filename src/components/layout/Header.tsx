import Link from "next/link";
import Image from "next/image";
import { ChevronDown, LogOut, KeyRound, Menu } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { navGroupsForRole } from "./navLinks";
import { signOutAction } from "@/app/actions";
import { ThemeToggle } from "./ThemeToggle";

const ROLE_LABEL: Record<Actor["role"], string> = {
  STUDENT: "Student",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

/** Shared styling for every interactive item in the nav bar: neutral by
 * default, a soft Lavender-tinted surface with Deep Orchid text on hover
 * (which on dark resolves to a slightly lighter, lavender-tinted surface --
 * same behaviour, per-theme values). No full brand-coloured fill: that reads
 * as a permanently "selected" item and dominates the bar in dark mode. */
const navItem =
  "rounded-md px-3 py-1.5 text-fg-secondary transition-colors hover:bg-brand-subtle hover:text-brand-fg";

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
                    <summary
                      className={`${navItem} flex cursor-pointer list-none items-center gap-1 marker:content-none group-open:bg-brand-subtle group-open:text-brand-fg`}
                    >
                      {group.label}
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="absolute left-0 z-20 mt-1 min-w-56 rounded-lg border border-line bg-surface-raised p-1.5 text-fg-secondary shadow-lg">
                      {group.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="block rounded-md px-3 py-2 hover:bg-brand-subtle hover:text-brand-fg"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </details>
                ) : (
                  group.links.map((link) => (
                    <Link key={link.href} href={link.href} className={`${navItem} whitespace-nowrap`}>
                      {link.label}
                    </Link>
                  ))
                ),
              )}
            </div>

            {/* Mobile: one hamburger panel, every group listed vertically. */}
            <details className="md:hidden">
              <summary className={`${navItem} flex w-fit cursor-pointer list-none items-center gap-1.5 marker:content-none`}>
                <Menu className="h-4 w-4" aria-hidden="true" />
                Menu
              </summary>
              <div className="mt-1 flex flex-col gap-3 rounded-lg border border-line bg-surface-subtle p-3">
                {groups.map((group, i) => (
                  <div key={group.label || i} className="flex flex-col gap-0.5">
                    {group.label && <p className="px-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">{group.label}</p>}
                    {group.links.map((link) => (
                      <Link key={link.href} href={link.href} className={navItem}>
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
