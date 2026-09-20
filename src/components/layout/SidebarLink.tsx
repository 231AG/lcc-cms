"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

/**
 * One sidebar row. The only client component in the app shell, and it is
 * one for exactly the reason the old MainNav was: App Router reuses a
 * shared layout's subtree across a client navigation, so a server-computed
 * "this is the current page" goes stale the moment you navigate. Reading
 * `usePathname` is the only way for the active state to stay honest.
 *
 * Everything else about the sidebar -- collapsing, the drawer, persistence
 * -- is CSS driven by an attribute on <html>, so this stays a leaf with no
 * state of its own.
 *
 * The icon arrives as `children`, ALREADY RENDERED by the server parent,
 * rather than as a component to render here. A component is a function, and
 * a function cannot cross the server/client boundary as a prop -- passing
 * the element keeps the icon server-rendered and this component a leaf.
 */
export function SidebarLink({
  href,
  label,
  siblings,
  children,
}: {
  href: string;
  label: string;
  /** Every href in this role's navigation, so the longest match can win. */
  siblings: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();

  // Current when it IS the page, or when the page sits under it, so
  // /admin/students/<id> keeps "Student Listing" marked. The trailing slash
  // matters: without it "/admin/student-plan" would also light up
  // "/admin/students".
  const matches = (candidate: string) => pathname === candidate || pathname.startsWith(`${candidate}/`);

  // ...but only the MOST specific match, because a nav item can now be the
  // parent of another one: "/portal" is an ancestor of "/portal/grades", and
  // a plain prefix test lights up Dashboard and My grades together on the
  // grades page. Longest wins, which needs no per-item flag and stays right
  // as pages are added underneath an existing item.
  const isCurrent =
    matches(href) && !siblings.some((other) => other !== href && other.length > href.length && matches(other));

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      // The label span below is display:none in the collapsed rail, which
      // removes it from the accessible name as well as from view. `title`
      // was carrying the name on its own there -- a documented fallback,
      // but the weakest one there is. An explicit label is the same string
      // at both widths and does not depend on CSS.
      aria-label={label}
      title={label}
      className={cn(
        "sidebar-rail-center focus-visible:outline-focus-ring group flex items-center gap-3 rounded-lg px-3 py-2.5",
        "text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        isCurrent
          ? "bg-sidebar-active text-sidebar-fg-active font-semibold shadow-sm"
          : "text-sidebar-fg-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
      )}
    >
      {children}
      {/* The visible label. `display:none` in the collapsed rail, which
          takes it out of the accessible name too -- which is exactly why
          the aria-label above exists rather than this span being trusted
          to carry the name at both widths. */}
      <span className="sidebar-full-only truncate">{label}</span>
    </Link>
  );
}
