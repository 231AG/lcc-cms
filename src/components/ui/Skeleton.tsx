import { cn } from "./cn";

/**
 * Loading placeholders. Deliberately structural, never fake data: a
 * skeleton row shows where content will be, and is visibly not a value --
 * this is an academic system of record, and a greyed-out plausible-looking
 * number in a table is worse than an obvious placeholder.
 *
 * `aria-hidden` throughout, with the live region left to the containing
 * `loading.tsx`, so a screen reader hears "Loading…" once rather than
 * reading out a dozen empty bars.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-line", className)} />;
}

/** A table-shaped placeholder matching a real header + N body rows. */
export function SkeletonTable({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <div aria-hidden="true" className="overflow-hidden">
      <div className="flex gap-3 border-b border-brand-line bg-brand-subtle-strong px-3 py-2.5">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 1 ? "flex-[2]" : "flex-1")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3 border-b border-brand-line px-3 py-3">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className={cn("h-3.5", i === 1 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The page shell every admin route shares: title block, a control row, and a card. */
export function SkeletonPage({ columns = 6, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="w-full">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-3.5 w-72" />
        </div>
        <Skeleton className="h-9 w-32 shrink-0" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="rounded-lg border border-line bg-surface shadow-sm">
        <SkeletonTable columns={columns} rows={rows} />
      </div>
    </main>
  );
}
