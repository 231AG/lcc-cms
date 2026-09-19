import Link from "next/link";
import Image from "next/image";
import { X } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { navGroupsForRole } from "./navLinks";
import { SidebarLink } from "./SidebarLink";

/**
 * The signed-in navigation: a full-height rail on desktop, an off-canvas
 * drawer below lg.
 *
 * A SERVER COMPONENT, deliberately. Collapsing the rail and opening the
 * drawer are both a single attribute on <html> that public/theme.js writes
 * and globals.css reacts to -- the same mechanism the colour theme has used
 * since it was built. So the whole shell ships no client React, the
 * collapsed width is correct on the very first paint rather than one render
 * later, and there is no hydration mismatch to get wrong.
 *
 * The one piece that genuinely needs the client is "which item am I on",
 * because App Router reuses a layout's subtree across a client navigation
 * and a server-computed answer goes stale. That is SidebarLink, and it is
 * the only client component here.
 *
 * The groups, their order, their links and their per-role membership all
 * come from navLinks.ts unchanged -- this is the same navigation the top
 * bar rendered, in a different shape.
 */
export function AppSidebar({ actor }: { actor: Actor }) {
  const groups = navGroupsForRole(actor.role);

  return (
    <aside
      id="app-sidebar"
      className="app-sidebar bg-sidebar text-sidebar-fg flex flex-col overflow-y-auto"
      aria-label="Main"
    >
      <div className="sidebar-rail-center flex items-center gap-3 px-4 py-5">
        <Link
          href="/portal"
          className="focus-visible:outline-focus-ring flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="bg-seal-backdrop flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl p-1 shadow-sm">
            <Image src="/lcc-logo.png" alt="" width={32} height={36} className="h-full w-full object-contain" priority />
          </span>
          <span className="sidebar-full-only min-w-0">
            <span className="block text-sm leading-tight font-bold">Liberia Christian College</span>
            <span className="text-sidebar-fg-muted block text-[11px] leading-tight">E-Portal</span>
          </span>
        </Link>

        {/* Drawer dismissal. Hidden on desktop, where the drawer does not
            exist and the rail is collapsed from the top bar instead. */}
        <button
          type="button"
          data-drawer-close=""
          aria-label="Close menu"
          className="hover:bg-sidebar-hover focus-visible:outline-focus-ring ml-auto rounded-lg p-2 lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-5 px-3 pt-2 pb-6">
        {groups.map((group, i) => (
          <div key={group.label || i} className="flex flex-col gap-1">
            {group.label && (
              <p className="sidebar-full-only text-sidebar-fg-muted px-3 pb-1 text-[11px] font-bold tracking-[0.1em] uppercase">
                {group.label}
              </p>
            )}
            {group.links.map(({ href, label, icon: Icon }) => (
              <SidebarLink key={href} href={href} label={label}>
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              </SidebarLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
