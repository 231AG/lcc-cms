import Link from "next/link";
import Image from "next/image";
import { LogOut, KeyRound } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { signOutAction } from "@/app/actions";
import { navItem } from "./navStyles";
import { ThemeToggle } from "./ThemeToggle";

const ROLE_LABEL: Record<Actor["role"], string> = {
  STUDENT: "Student",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

/**
 * The slim bar for the two states that get no sidebar: a signed-out visitor
 * on a public page, and a user who must change their password before
 * anything else. Neither can navigate anywhere, so neither is offered
 * navigation -- which is why this carries no nav links at all now that
 * AppSidebar handles the signed-in case.
 *
 * Server Component: takes the already-resolved actor from the (portal)
 * layout rather than re-querying, so it costs nothing extra per request.
 * The theme toggle sits outside the `actor` branch so it is available to
 * signed-out visitors too.
 */
export function Header({ actor }: { actor: Actor | null }) {
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
                <Link href="/change-password" aria-label="Change password" className={`${navItem} flex items-center gap-1.5 px-2`}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Change password</span>
                </Link>
                <form action={signOutAction}>
                  {/* Icon only on mobile, matching Change password beside it:
                      the label is the first thing worth dropping when the bar
                      runs out of room. `aria-label` (not `title`) keeps the
                      accessible name at every width -- the visible text is
                      hidden, not removed, so nothing announces as "button". */}
                  <button type="submit" aria-label="Sign out" className={`${navItem} flex items-center gap-1.5 px-2`}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
