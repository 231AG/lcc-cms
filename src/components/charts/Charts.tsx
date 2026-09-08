import type { CountByLabel } from "@/lib/dashboard/statistics";
import { cn } from "@/components/ui/cn";

/**
 * The dashboard's charts, built as plain HTML and CSS.
 *
 * No charting library and no client component: these are bars whose lengths
 * are percentages, which is one `style={{ width }}` away from being correct
 * and zero kilobytes of JavaScript away from being fast. The dashboard is
 * the first screen an Admin loads, and shipping a plotting runtime to draw
 * eight rectangles would be the single largest thing on the page.
 *
 * Design rules being followed deliberately:
 *
 *  - EVERY BAR IS DIRECTLY LABELLED with its name and its value. Colour is
 *    never the only channel carrying identity, which is also what licenses
 *    the two colours below that sit under 3:1 against the page (amber and
 *    the neutral grey): the label is the required relief, not an optional
 *    nicety.
 *  - ONE HUE for a single series. The College and Enrolment-year charts are
 *    one series each, so they are one colour and carry no legend -- the
 *    heading names them. Only the status chart is multi-colour, and that is
 *    because status colour is meaningful there (suspended is red because it
 *    is red everywhere else in this app), not decoration.
 *  - The status colours are the app's own semantic tokens, so a status reads
 *    identically on a badge, in an alert and on this chart. Validated for
 *    colour-vision separation; the neutral grey deliberately stays neutral,
 *    because "inactive" is exactly what a neutral means here.
 *  - Rounded data-ends, a recessive track, and a hover title on every bar.
 */

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "var(--success-solid)",
  GRADUATED: "var(--info-solid)",
  ADMISSION_FORFEITED: "var(--warning-solid)",
  SUSPENDED: "var(--danger-solid)",
  INACTIVE: "var(--fg-subtle)",
};

/** A single headline figure. Not a chart -- one number does not need one. */
export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-fg tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/**
 * Horizontal bars, ranked. The right form when the categories have names
 * long enough that a vertical chart would rotate them 45 degrees.
 */
export function BarList({
  data,
  colorFor,
  emptyMessage = "No data yet.",
}: {
  data: CountByLabel[];
  /** Omit for a single-series chart -- it then draws in one brand hue. */
  colorFor?: (label: string) => string;
  emptyMessage?: string;
}) {
  if (data.length === 0) return <p className="text-sm text-fg-muted">{emptyMessage}</p>;
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-fg-secondary" title={row.label}>
              {row.label}
            </span>
            <span className="shrink-0 font-semibold text-fg tabular-nums">{row.count}</span>
          </div>
          {/* The track is the recessive part: it shows the scale without
              competing with the value drawn on top of it. */}
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.count / max) * 100, 2)}%`,
                background: colorFor ? colorFor(row.label) : "var(--primary)",
              }}
              // A native tooltip: real hover feedback with no event handlers,
              // no client bundle, and it works on keyboard focus of the row.
              title={`${row.label}: ${row.count}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Ranked bars using the app's own status colours. */
export function StatusBarList({ data }: { data: CountByLabel[] }) {
  return <BarList data={data} colorFor={(label) => STATUS_COLOR[label] ?? "var(--primary)"} emptyMessage="No students enrolled yet." />;
}

/**
 * Vertical columns for a series that runs along time. Deliberately a
 * different form from the two bar lists above: enrolment year is ordered,
 * and reading it left-to-right is the whole point, so it must not look like
 * another ranked list.
 */
export function ColumnChart({ data, className }: { data: CountByLabel[]; className?: string }) {
  if (data.length === 0) return <p className="text-sm text-fg-muted">No enrolment years recorded yet.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className={cn("overflow-x-auto", className)}>
      {/* One continuous baseline under the whole series, not a stub rule per
          column -- the gaps between columns turned a per-label border into a
          dashed axis that read as broken. */}
      <div className="flex items-end gap-2 border-b border-line">
        {data.map((row) => (
          <div key={row.label} className="flex min-w-12 flex-1 flex-col items-center gap-1">
            <span className="text-xs font-semibold text-fg tabular-nums">{row.count}</span>
            {/* Anchored to the baseline with a rounded top; a floor of 4px so
                a year with a single student is still visibly a bar rather than
                a hairline that reads as zero. */}
            <div
              className="w-full rounded-t bg-primary"
              style={{ height: `${Math.max((row.count / max) * 120, 4)}px` }}
              title={`${row.label}: ${row.count}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {data.map((row) => (
          <span key={row.label} className="min-w-12 flex-1 pt-1 text-center text-xs whitespace-nowrap text-fg-muted">
            {row.label}
          </span>
        ))}
      </div>
    </div>
  );
}
