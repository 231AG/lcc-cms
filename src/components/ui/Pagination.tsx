import Link from "next/link";
import { cn } from "./cn";

/**
 * Shared pagination control: Previous / numbered pages with ellipsis for
 * long ranges / Next. Every page in this app paginates through plain URL
 * search params and real `<a>` links (no client state), so this takes a
 * `hrefForPage` builder from the caller rather than owning any routing
 * knowledge of its own.
 *
 * Renders nothing at all for a single page -- callers don't need to guard.
 */

/** Below this, every page number is listed -- collapsing "1 2 3 4 5" into
 * "1 2 … 5" saves no room and only costs the reader a click. */
const ALWAYS_SHOW_ALL_UP_TO = 7;

/** first, last, and a window around the current page; `null` marks a gap. */
export function pageWindow(page: number, totalPages: number, radius = 1): Array<number | null> {
  if (totalPages <= 1) return [1];
  if (totalPages <= ALWAYS_SHOW_ALL_UP_TO) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const wanted = new Set<number>([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let previous = 0;
  for (const p of sorted) {
    // A single skipped page is rendered as that page, not an ellipsis --
    // "1 … 3" wastes as much room as "1 2 3" and reads worse.
    if (p - previous === 2) out.push(previous + 1);
    else if (p - previous > 2) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}

const linkBase =
  "inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 text-sm font-medium transition-colors";

export function Pagination({
  page,
  totalPages,
  hrefForPage,
  className,
  label = "Pagination",
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  className?: string;
  label?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center gap-1", className)}>
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} className={cn(linkBase, "border-neutral-300 text-neutral-700 hover:bg-neutral-50")} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={cn(linkBase, "border-neutral-200 text-neutral-400")} aria-hidden="true">
          Previous
        </span>
      )}

      {pageWindow(page, totalPages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-neutral-400" aria-hidden="true">
            &hellip;
          </span>
        ) : p === page ? (
          <span key={p} aria-current="page" className={cn(linkBase, "border-brand-600 bg-brand-600 text-white")}>
            {p}
          </span>
        ) : (
          <Link
            key={p}
            href={hrefForPage(p)}
            aria-label={`Page ${p}`}
            className={cn(linkBase, "border-neutral-300 text-neutral-700 hover:bg-neutral-50")}
          >
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={hrefForPage(page + 1)} className={cn(linkBase, "border-neutral-300 text-neutral-700 hover:bg-neutral-50")} rel="next">
          Next
        </Link>
      ) : (
        <span className={cn(linkBase, "border-neutral-200 text-neutral-400")} aria-hidden="true">
          Next
        </span>
      )}
    </nav>
  );
}
