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
export function SidebarLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const pathname = usePathname();

  // Current when it IS the page, or when the page sits under it, so
  // /admin/students/<id> keeps "Student Listing" marked. The trailing slash
  // matters: without it "/admin/student-plan" would also light up
  // "/admin/students".
  const isCurrent = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
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
      {/* Hidden by CSS when the rail is collapsed, but never removed: the
          accessible name has to survive at both widths, and `title` alone
          is not a reliable one. */}
      <span className="sidebar-full-only truncate">{label}</span>
    </Link>
  );
}
