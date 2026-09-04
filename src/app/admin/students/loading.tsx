import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Matches the real Students page structure -- breadcrumb, title, the
 * primary action, the card heading, the filter row, then seven-column
 * rows. Structural placeholders only, never plausible-looking fake values:
 * this is an academic system of record and a greyed-out Student ID that
 * turns out not to exist is worse than an obvious bar.
 */
export default function StudentsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:py-10">
      <span className="sr-only" role="status">
        Loading students…
      </span>

      <Skeleton className="mb-2 h-3 w-28" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-end justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
          <div className="w-full">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-40 shrink-0" />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-neutral-100 px-4 py-3 sm:px-5">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <SkeletonTable columns={7} rows={8} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-8 w-56" />
      </div>
    </main>
  );
}
