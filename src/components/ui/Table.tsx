import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/** Thin styling wrappers around real table elements -- every page keeps its own
 * <table>/<thead>/<tbody> structure and column set, this just gives them one
 * consistent look instead of each page hand-rolling border-collapse/text-sm/etc.
 *
 * The palette is purple-on-white, not gray-on-white: the header band is the
 * Lavender tint (`brand-subtle-strong`) with Deep Orchid text, and every rule
 * between cells is the Lavender border rather than a neutral gray. These are
 * the same semantic tokens the rest of the app already uses, so both themes
 * come for free -- on dark they resolve to the lavender-tinted inks, never to
 * a large saturated purple fill (see the note at the top of globals.css).
 *
 * Nearly every table in the app is built from these five components, so this
 * file is the whole of the "tables are purple/white, not gray" change. */

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
  return <th className={cn("border-b border-brand-line px-3 py-2 font-semibold", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-brand-line px-3 py-2 align-top", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-hover", className)} {...props} />;
}
