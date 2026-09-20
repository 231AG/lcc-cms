import { Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import { X } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { cn } from "@/components/ui/cn";
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
 * THREE BANDS, and the middle one is the only one that moves: brand,
 * scrolling list, footer. The aside is `overflow-hidden` and pinned to the
 * viewport height (see .app-sidebar in globals.css) -- before that it
 * simply grew to fit thirteen Admin items, took the grid row with it, and
 * scrolling a long page carried the College seal off the top of the window.
 *
 * The groups, their order, their links and their per-role membership all
 * come from navLinks.ts unchanged.
 */
export function AppSidebar({ actor }: { actor: Actor }) {
  const groups = navGroupsForRole(actor.role);
  // Flattened once here rather than per link: SidebarLink needs the whole
  // set to decide which of several matching items is the specific one.
  const allHrefs = groups.flatMap((group) => group.links.map((link) => link.href));

  return (
    <aside
      id="app-sidebar"
      className="app-sidebar bg-sidebar text-sidebar-fg flex flex-col overflow-hidden"
      aria-label="Main"
    >
      {/* Brand. `shrink-0` so a long nav never squeezes it, and the close
          button is aligned to the top because the title wraps to two lines
          in the narrow drawer and a vertically-centred X beside it looks
          adrift. */}
      <div className="sidebar-rail-center flex shrink-0 items-start gap-3 px-4 pt-5 pb-4">
        {/* aria-label, because the only text in this link lives in the
            span below and the collapsed rail `display:none`s it -- which
            takes it out of the accessible name computation too, leaving a
            link called nothing. That was survivable while collapsing was a
            deliberate choice; it is not now that the rail starts collapsed
            on every laptop. The label matches the visible text, so the name
            is the same at both widths. */}
        <Link
          href="/portal"
          aria-label="Liberia Christian College E-Portal, go to dashboard"
          className="focus-visible:outline-focus-ring flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="bg-seal-backdrop flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl p-1 shadow-sm">
            <Image src="/lcc-logo.png" alt="" width={32} height={36} className="h-full w-full object-contain" priority />
          </span>
          <span className="sidebar-full-only min-w-0">
            <span className="block text-[13px] leading-[1.25] font-bold">Liberia Christian College</span>
            <span className="text-sidebar-fg-muted mt-0.5 block text-[10px] leading-tight tracking-[0.08em] uppercase">
              E-Portal
            </span>
          </span>
        </Link>

        {/* Drawer dismissal. Hidden on desktop, where the drawer does not
            exist and the rail is collapsed from the top bar instead. */}
        <button
          type="button"
          data-drawer-close=""
          aria-label="Close menu"
          className="hover:bg-sidebar-hover focus-visible:outline-focus-ring -mt-1 ml-auto shrink-0 rounded-lg p-2 lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* The only band that scrolls. */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 pt-1 pb-4">
        {groups.map((group, i) => (
          <Fragment key={group.label || `group-${i}`}>
            {/* What separates one group from the next.
                A heading does that job at full width, so a rule there would
                say the same thing twice -- but a group with NO heading has
                nothing except whitespace to explain the gap, which is how
                the Student nav ended up with an unexplained hole under
                Dashboard. Collapsed, every heading is hidden, so every
                boundary takes the rule instead; without it thirteen icons
                read as one undifferentiated column. */}
            {i > 0 && (
              <div
                role="presentation"
                className={cn("mx-3 my-3 border-t border-white/10", group.label && "sidebar-rail-only")}
              />
            )}

            {group.label && (
              <p className="sidebar-full-only text-sidebar-fg-muted mt-5 mb-1.5 px-3 text-[10px] font-bold tracking-[0.12em] uppercase first:mt-0">
                {group.label}
              </p>
            )}

            <div className="flex flex-col gap-0.5">
              {group.links.map(({ href, label, icon: Icon }) => (
                <SidebarLink key={href} href={href} label={label} siblings={allHrefs}>
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                </SidebarLink>
              ))}
            </div>
          </Fragment>
        ))}
      </nav>

      {/* The College's own line, at the foot of the rail. Hidden when the
          rail is collapsed, where there is no room for it to read as
          anything but noise. Left-aligned like everything above it, and
          ruled off so it reads as the end of the rail rather than as a
          stray caption floating in the gradient. */}
      <div className="shrink-0 px-4 pb-5">
        <p className="sidebar-full-only text-sidebar-fg-muted border-t border-white/10 pt-4 text-[10px] leading-tight tracking-[0.08em] uppercase">
          Excellence &middot; Faith &middot; Service
        </p>
      </div>
    </aside>
  );
}
