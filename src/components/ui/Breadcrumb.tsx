import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

/**
 * Small trail above a page title. Visually subordinate to the `<h1>` by
 * design -- it orients, it does not compete.
 *
 * A real `<nav aria-label="Breadcrumb">` with an ordered list, since the
 * order is the meaning; the last item is the current page and is rendered
 * as plain text with `aria-current`, not as a link to itself.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-brand-fg hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-fg-secondary" : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight className="h-3 w-3 text-fg-subtle" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
