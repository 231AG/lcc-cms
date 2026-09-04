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

  // The disabled Previous/Next caps are aria-hidden and non-interactive, so
  // WCAG's contrast minimum does not strictly apply to them -- but
  // `text-fg-subtle` measured 2.46:1 against the light-mode page background,
  // which is simply hard to read. `text-fg-muted` is the app's standard
  // muted-text treatment and still reads as unavailable beside the live
  // controls, which carry a stronger border and a hover state.
  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center gap-1", className)}>
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} className={cn(linkBase, "border-line-strong text-fg-secondary hover:bg-surface-hover")} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={cn(linkBase, "border-line text-fg-muted")} aria-hidden="true">
          Previous
        </span>
      )}

      {pageWindow(page, totalPages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-fg-muted" aria-hidden="true">
            &hellip;
          </span>
        ) : p === page ? (
          <span key={p} aria-current="page" className={cn(linkBase, "border-primary bg-primary text-on-primary")}>
            {p}
          </span>
        ) : (
          <Link
            key={p}
            href={hrefForPage(p)}
            aria-label={`Page ${p}`}
            className={cn(linkBase, "border-line-strong text-fg-secondary hover:bg-surface-hover")}
          >
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={hrefForPage(page + 1)} className={cn(linkBase, "border-line-strong text-fg-secondary hover:bg-surface-hover")} rel="next">
          Next
        </Link>
      ) : (
        <span className={cn(linkBase, "border-line text-fg-muted")} aria-hidden="true">
          Next
        </span>
      )}
    </nav>
  );
}
