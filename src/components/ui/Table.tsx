import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "./cn";

/** Thin styling wrappers around real table elements -- every page keeps its own
 * <table>/<thead>/<tbody> structure and column set, this just gives them one
 * consistent look instead of each page hand-rolling border-collapse/text-sm/etc.
 *
 * The palette is purple-on-white, not gray-on-white: the header band is the
 * Lavender tint (`brand-subtle-strong`) with Deep Orchid text, and every rule
 * is the Lavender border rather than a neutral gray. These are the same
 * semantic tokens the rest of the app already uses, so both themes come for
 * free -- on dark they resolve to the lavender-tinted inks, never to a large
 * saturated purple fill (see the note at the top of globals.css).
 *
 * Cells are ruled on ALL FOUR SIDES, not just underneath. A wide table with
 * many columns (course offerings has twelve) is much easier to read across
 * when the columns are visibly separated -- with horizontal rules only, the
 * eye loses which value belongs to which heading halfway along the row.
 * `border-collapse` means adjacent cells share one line, so this is a single
 * rule per boundary, not a doubled one.
 *
 * Nearly every table in the app is built from these components, so this file
 * is the whole of the "tables are purple/white with column borders" change. */

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-brand-subtle-strong text-left text-xs font-semibold uppercase tracking-wide text-brand-fg",
        className,
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border border-brand-line px-3 py-2 font-semibold", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border border-brand-line px-3 py-2 align-top", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-hover", className)} {...props} />;
}

export type SortDirection = "asc" | "desc";

/**
 * A column heading you can sort by.
 *
 * Sorting is a plain link that rewrites the URL, like every other control in
 * this app -- so a sorted view is bookmarkable and shareable, it survives a
 * reload, and it needs no client component. Clicking the active column flips
 * the direction; clicking another column starts it ascending.
 *
 * The arrow is not the only signal: `aria-sort` tells a screen reader which
 * column is sorted and which way, and the link's title says what a click
 * will do.
 */
export function SortableTh({
  label,
  column,
  activeColumn,
  direction,
  hrefFor,
  className,
}: {
  label: string;
  /** This column's sort key. */
  column: string;
  /** The key currently being sorted by, if any. */
  activeColumn?: string;
  direction: SortDirection;
  hrefFor: (column: string, direction: SortDirection) => string;
  className?: string;
}) {
  const isActive = activeColumn === column;
  const nextDirection: SortDirection = isActive && direction === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <Th className={className} aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={hrefFor(column, nextDirection)}
        title={`Sort by ${label}, ${nextDirection === "asc" ? "ascending" : "descending"}`}
        className="inline-flex items-center gap-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {label}
        <Icon className={cn("h-3 w-3 shrink-0", isActive ? "text-brand-fg" : "text-fg-subtle")} aria-hidden="true" />
      </Link>
    </Th>
  );
}
