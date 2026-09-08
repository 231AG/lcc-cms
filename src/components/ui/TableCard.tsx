import type { ReactNode } from "react";
import { Card } from "./Card";

/**
 * A listing table in a card, with the header strip the Students listing
 * established: a title, a count of what is in the table under the current
 * filters, and any per-table actions on the right.
 *
 * Extracted because it is now the shape of every listing in the app --
 * students, offerings, colleges, departments, courses, semesters, audit --
 * and the alternative is the same forty lines of flex-and-border classes
 * copied seven times, drifting apart one padding value at a time.
 *
 * `filters` is a separate slot rather than part of `children` so the filter
 * row always sits between the header and the table, with the same divider
 * above and below it, whatever a caller passes.
 */
export function TableCard({
  title,
  count,
  countLabel,
  actions,
  filters,
  children,
  id,
}: {
  title: ReactNode;
  /** Rows currently in the table. Omitted when a count would be noise. */
  count?: number;
  /** Singular noun; pluralised with an "s" unless `count` is 1. */
  countLabel?: string;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Card className="overflow-hidden" id={id}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-4 py-4 sm:px-5">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">{title}</h2>
          {count !== undefined && countLabel && (
            <p className="mt-0.5 text-xs text-fg-muted">
              {count} {countLabel}
              {count === 1 ? "" : "s"}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>

      {filters && (
        <div className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3 sm:px-5">{filters}</div>
      )}

      {children}
    </Card>
  );
}

/**
 * The "nothing here" panel that replaces the table when a listing is empty,
 * so an empty result is a sentence rather than a header row over nothing.
 */
export function TableEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center sm:px-5">
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-fg-muted">{children}</div>}
    </div>
  );
}
