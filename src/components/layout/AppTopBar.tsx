import Link from "next/link";
import { KeyRound, LogOut, Menu, PanelLeft } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { signOutAction } from "@/app/actions";
import { ThemeToggle } from "./ThemeToggle";
import { SubmitIconButton } from "@/components/ui/SubmitButton";

const ROLE_LABEL: Record<Actor["role"], string> = {
  STUDENT: "Student",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

const iconButton =
  "flex items-center justify-center rounded-lg p-2 text-fg-muted transition-colors " +
  "hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The bar above the page content: the sidebar controls on the left, the
 * account controls on the right.
 *
 * A Server Component. Both toggles are plain buttons that public/theme.js
 * finds by data attribute, the same way the theme toggle beside them has
 * always worked -- no client React in the shell.
 *
 * Deliberately NOT here: a global search box and a notification bell. The
 * design reference shows both, but this app has neither a global search
 * nor any notion of notifications, and shipping chrome that does nothing
 * is worse than leaving the space clean.
 */
export function AppTopBar({ actor }: { actor: Actor }) {
  const initials = actor.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="app-topbar border-line bg-surface sticky top-0 z-30 border-b">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        {/* Two controls, one per breakpoint: the drawer below lg, the rail
            collapse above it. Both carry aria-expanded, which theme.js keeps
            in step when it flips the attribute on <html>. */}
        <button
          type="button"
          data-drawer-toggle=""
          aria-controls="app-sidebar"
          aria-expanded="false"
          aria-label="Open menu"
          className={`${iconButton} lg:hidden`}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-sidebar-toggle=""
          aria-controls="app-sidebar"
          aria-expanded="true"
          aria-label="Collapse or expand the sidebar"
          className={`${iconButton} hidden lg:flex`}
        >
          <PanelLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle className="rounded-lg p-2" />
          <Link href="/change-password" aria-label="Change password" className={iconButton}>
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </Link>
          <form action={signOutAction} className="flex">
            <SubmitIconButton
              aria-label="Sign out"
              className={iconButton}
              icon={<LogOut className="h-5 w-5" aria-hidden="true" />}
            />
          </form>

          <span className="bg-line-subtle mx-1 hidden h-8 w-px sm:block" aria-hidden="true" />

          <div className="flex items-center gap-2.5">
            <span
              className="bg-brand-subtle-strong text-brand-fg flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="text-fg block text-sm font-semibold">{actor.displayName}</span>
              <span className="text-fg-muted block text-xs">{ROLE_LABEL[actor.role]}</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
