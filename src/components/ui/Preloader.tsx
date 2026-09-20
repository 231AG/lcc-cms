import Image from "next/image";
import { cn } from "./cn";

/**
 * The whole-page pre-loader: what fills the screen while a route is still
 * being built on the server.
 *
 * The College's own seal held inside a brand-coloured ring that turns
 * around it. Chosen from three candidates; the other two (rising bars, and
 * a wordmark over a sweeping track) are not kept, because one wait should
 * look the same everywhere in the app.
 *
 * What it is built to be:
 *
 *   - A Server Component with no client JavaScript at all. A route loader
 *     renders before any bundle has been hydrated, so anything that needed
 *     React to move would appear after the wait it exists to cover.
 *   - One `role="status"` with a real sentence in it, everything else
 *     `aria-hidden`. A screen reader hears "Loading Liberia Christian
 *     College…" once, not a description of a spinning ring.
 *   - No fake progress: this does not know how far through the work is, so
 *     it draws no percentage and no bar that implies one.
 *   - Still and legible under prefers-reduced-motion -- the ring stops as
 *     a complete ring, not a half-drawn frame (see globals.css).
 *
 * `label` is the sentence, and a caller says what is actually being
 * fetched where it knows -- "Loading your grades…" beats a generic wait on
 * a screen that only ever loads one thing.
 */
export function Preloader({ label = "Loading Liberia Christian College…", className }: { label?: string; className?: string }) {
  return (
    <main
      className={cn("flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      <div className="relative flex h-28 w-28 items-center justify-center" aria-hidden="true">
        <span className="preloader-ring absolute inset-0 rounded-full" />
        <span className="bg-seal-backdrop flex h-20 w-20 items-center justify-center rounded-full p-3 shadow-sm">
          <Image src="/lcc-logo.png" alt="" width={32} height={36} className="h-full w-full object-contain" priority />
        </span>
      </div>
      <p className="text-fg mt-6 text-sm font-semibold">{label}</p>
      <p className="text-fg-muted mt-1 text-xs">One moment while the record is fetched.</p>
      <span role="status" className="sr-only">
        {label}
      </span>
    </main>
  );
}
