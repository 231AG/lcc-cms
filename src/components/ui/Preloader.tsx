import Image from "next/image";
import { cn } from "./cn";

/**
 * Whole-page pre-loaders: what fills the screen while a route is still
 * being built on the server.
 *
 * Three candidates, to be narrowed to one. They share a contract:
 *
 *   - Server Components with no client JavaScript at all. A route loader
 *     renders before any bundle has been hydrated, so anything that needed
 *     React to move would appear after the wait it exists to cover.
 *   - One `role="status"` with a real sentence in it, and every decorative
 *     part `aria-hidden`. A screen reader should hear "Loading Liberia
 *     Christian College…" once, not a description of a spinning ring.
 *   - No fake progress. None of these knows how far through the work is,
 *     so none of them draws a percentage.
 *   - They stop moving under prefers-reduced-motion (see globals.css), and
 *     stop in a state that still reads as deliberate.
 *
 * `label` is the sentence, and the caller says what is actually being
 * fetched where it knows -- "Loading your grades…" beats a generic wait on
 * a screen that only ever loads one thing.
 */

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main
      className={cn("flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      {children}
    </main>
  );
}

const DEFAULT_LABEL = "Loading Liberia Christian College…";

/**
 * Design A — The seal in a turning ring.
 *
 * The College's own mark held inside a brand-coloured ring that sweeps
 * round it. The most formal of the three: it says the institution's name
 * without a word, and the motion is one steady rotation rather than
 * anything bouncy.
 */
export function PreloaderSeal({ label = DEFAULT_LABEL }: { label?: string }) {
  return (
    <Frame>
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
    </Frame>
  );
}

/**
 * Design B — Rising bars.
 *
 * Five brand bars rising and falling in a wave, which is the same figure
 * the dashboards already draw their charts with, so the wait looks like
 * part of this app rather than a stock spinner. The liveliest of the
 * three, and the smallest: it works just as well inside a card as it does
 * on a whole page.
 */
export function PreloaderBars({ label = DEFAULT_LABEL }: { label?: string }) {
  // Staggered so the wave reads left to right. Heights vary too, so it
  // keeps a chart's silhouette rather than a perfect sine.
  const bars = [
    { delay: "0ms", height: "h-10" },
    { delay: "110ms", height: "h-14" },
    { delay: "220ms", height: "h-16" },
    { delay: "330ms", height: "h-14" },
    { delay: "440ms", height: "h-10" },
  ];

  return (
    <Frame>
      <div className="flex h-16 items-end gap-2" aria-hidden="true">
        {bars.map((bar, i) => (
          <span
            key={i}
            style={{ animationDelay: bar.delay }}
            className={cn("preloader-bar bg-brand-fg w-3 rounded-t-md", bar.height)}
          />
        ))}
      </div>
      <p className="text-fg mt-6 text-sm font-semibold">{label}</p>
      <p className="text-fg-muted mt-1 text-xs">One moment while the record is fetched.</p>
      <span role="status" className="sr-only">
        {label}
      </span>
    </Frame>
  );
}

/**
 * Design C — Wordmark and sweep.
 *
 * The College name over a slim track with a brand segment sweeping across
 * it, and three dots pulsing beneath. The quietest of the three and the
 * only one that reads as a document loading rather than an app starting —
 * it sits best over a page that is otherwise mostly text.
 */
export function PreloaderSweep({ label = DEFAULT_LABEL }: { label?: string }) {
  return (
    <Frame>
      <div className="w-full max-w-sm" aria-hidden="true">
        <p className="text-fg text-lg font-extrabold tracking-tight">Liberia Christian College</p>
        <p className="text-fg-muted mt-0.5 text-[11px] font-semibold tracking-[0.2em] uppercase">Student Records</p>
        <div className="bg-line-subtle mt-5 h-1.5 w-full overflow-hidden rounded-full">
          <span className="preloader-sweep bg-brand-fg block h-full w-1/4 rounded-full" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-1.5">
          {["0ms", "160ms", "320ms"].map((delay) => (
            <span key={delay} style={{ animationDelay: delay }} className="preloader-dot bg-brand-fg h-1.5 w-1.5 rounded-full" />
          ))}
        </div>
      </div>
      <p className="text-fg-muted mt-5 text-xs">{label}</p>
      <span role="status" className="sr-only">
        {label}
      </span>
    </Frame>
  );
}
