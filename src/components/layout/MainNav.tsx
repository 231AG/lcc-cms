"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { NavGroup } from "./navLinks";
import { navItem, navItemActive, navItemActiveInset } from "./navStyles";

/**
 * The role-based navigation: inline links for unlabeled groups, a
 * click-to-open dropdown for each labeled one, and a single hamburger
 * panel on mobile.
 *
 * WHY THIS IS A CLIENT COMPONENT (it used to be plain server-rendered
 * `<details>` elements, which is what the reported bug actually was):
 *
 *  - A `<details>` element's open/closed state lives in the DOM, not in
 *    React. The header is rendered by the (portal) layout, and App Router
 *    partial rendering reuses a shared layout's subtree across a client
 *    navigation -- the element is never remounted, so `open` survived the
 *    navigation and the menu stayed open on the page you had just gone to.
 *  - Clicking the item you are already on is not a navigation at all, so
 *    there was nothing to close it even in principle. That is the "doesn't
 *    close when it's already active" half of the report.
 *  - Native `<details>` has no click-outside or Escape behaviour, so the
 *    only way to close a menu was to click its own summary again.
 *
 * So the fix is to hold the open menu in React state and close it on the
 * four events that should close it: choosing an item (even the current
 * one), a route change, a pointer press outside the nav, and Escape. No
 * new dependency: this is one small component over `usePathname`, not a
 * menu library, and the app already ships client components of this size
 * (see admin/students/StudentsTable.tsx).
 *
 * `usePathname` is also what makes an honest active state possible: a
 * server-computed "current page" would go stale on exactly the same
 * partial renders described above.
 */
export function MainNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuIdPrefix = useId();

  const closeAll = () => {
    setOpenMenu(null);
    setMobileOpen(false);
  };

  const anyOpen = openMenu !== null || mobileOpen;

  // A route change always closes the menus -- including one this component
  // did not start, such as the browser Back button or a redirect. Adjusted
  // during render rather than in an effect (React's documented "storing
  // information from previous renders" pattern): the menu must already be
  // gone in the frame that paints the new route, not one render later.
  //
  // Choosing an item closes the menus directly as well (below), which is
  // what covers clicking the item you are already on: that navigates
  // nowhere, so there is no pathname change here to react to.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setOpenMenu(null);
    setMobileOpen(false);
  }

  // Click-outside and Escape, bound only while something is open so the
  // app carries no idle document-level listeners.
  useEffect(() => {
    if (!anyOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) closeAll();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeAll();
      // Escape returns focus to the control that opened the menu, rather
      // than leaving it on a button that has just been removed.
      const active = document.activeElement;
      if (active instanceof HTMLElement && navRef.current?.contains(active)) return;
      navRef.current?.querySelector<HTMLElement>("[data-nav-trigger]")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anyOpen]);

  /**
   * A link is current when it IS the page, or when the page sits under it
   * (`/admin/students/<id>` keeps "Students" marked). The trailing slash
   * matters: without it "/admin/student-plan" would also light up
   * "/admin/students".
   */
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const groupIsCurrent = (group: NavGroup) => group.links.some((link) => isCurrent(link.href));

  return (
    <nav ref={navRef} aria-label="Main" className="pb-2 text-sm">
      {/* Desktop: unlabeled groups render inline, labeled groups as a
          click-to-open dropdown. Only one is ever open, because `openMenu`
          holds a single label. */}
      <div className="hidden flex-wrap items-center gap-1 md:flex">
        {groups.map((group) =>
          group.label ? (
            <div key={group.label} className="relative">
              <button
                type="button"
                data-nav-trigger=""
                aria-expanded={openMenu === group.label}
                aria-controls={`${menuIdPrefix}-${group.label}`}
                // "true", not "page": the button is not the page, it is the
                // group the current page sits in. Without this the active
                // treatment on a closed dropdown would be colour only.
                aria-current={groupIsCurrent(group) ? "true" : undefined}
                onClick={() => setOpenMenu((current) => (current === group.label ? null : group.label))}
                className={cn(
                  navItem,
                  "flex cursor-pointer items-center gap-1",
                  groupIsCurrent(group) && navItemActive,
                  openMenu === group.label && "bg-brand-subtle text-brand-fg",
                )}
              >
                {group.label}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", openMenu === group.label && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
              {openMenu === group.label && (
                <div
                  id={`${menuIdPrefix}-${group.label}`}
                  className="absolute left-0 z-20 mt-1 min-w-56 rounded-lg border border-line bg-surface-raised p-1.5 text-fg-secondary shadow-lg"
                >
                  {group.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={isCurrent(link.href) ? "page" : undefined}
                      onClick={closeAll}
                      className={cn(
                        "block rounded-md px-3 py-2 hover:bg-brand-subtle hover:text-brand-fg",
                        isCurrent(link.href) && navItemActiveInset,
                      )}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
                onClick={closeAll}
                className={cn(navItem, "whitespace-nowrap", isCurrent(link.href) && navItemActive)}
              >
                {link.label}
              </Link>
            ))
          ),
        )}
      </div>

      {/* Mobile: one hamburger panel, every group listed vertically. */}
      <div className="md:hidden">
        <button
          type="button"
          data-nav-trigger=""
          aria-expanded={mobileOpen}
          aria-controls={`${menuIdPrefix}-mobile`}
          onClick={() => setMobileOpen((open) => !open)}
          className={cn(navItem, "flex w-fit cursor-pointer items-center gap-1.5", mobileOpen && "bg-brand-subtle text-brand-fg")}
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Menu
        </button>
        {mobileOpen && (
          <div id={`${menuIdPrefix}-mobile`} className="mt-1 flex flex-col gap-3 rounded-lg border border-line bg-surface-subtle p-3">
            {groups.map((group, i) => (
              <div key={group.label || i} className="flex flex-col gap-0.5">
                {group.label && <p className="px-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">{group.label}</p>}
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    onClick={closeAll}
                    className={cn(navItem, isCurrent(link.href) && navItemActiveInset)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
