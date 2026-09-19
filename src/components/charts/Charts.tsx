import type { ReactNode } from "react";
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

/** The tinted icon chips on the stat cards. Four tones so a row of four
 * reads as four different things at a glance, which is what the design
 * reference uses them for -- they carry no meaning of their own, so nothing
 * depends on telling them apart. The number and its label do all the work. */
export type StatTone = "brand" | "accent" | "info" | "success";

const STAT_CHIP: Record<StatTone, string> = {
  brand: "bg-brand-subtle-strong text-brand-fg",
  accent: "bg-accent-soft text-accent-soft-fg",
  info: "bg-info-surface text-info-fg",
  success: "bg-success-surface text-success-fg",
};

/** A single headline figure. Not a chart -- one number does not need one.
 *
 * `icon` and `tone` are optional: a caller that passes neither gets the
 * plain tile it always got, so this did not have to be threaded through
 * every call site at once. There is deliberately no "up 12%" chip like the
 * reference shows -- nothing in this app computes a period-over-period
 * delta, and a number that looks measured but is not is worse than no
 * number. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "brand",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="border-line bg-surface flex items-start gap-3.5 rounded-2xl border p-4 shadow-[0_1px_2px_rgb(16_12_32_/_0.04),0_8px_24px_-12px_rgb(16_12_32_/_0.12)] sm:p-5">
      {icon && (
        <span
          className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", STAT_CHIP[tone])}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
        <p className="text-fg mt-1 text-3xl font-extrabold tabular-nums">{value}</p>
        {hint && <p className="text-fg-muted mt-0.5 text-xs">{hint}</p>}
      </div>
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

  // Round the top of the scale up so the ticks are whole numbers rather than
  // four divisions of an arbitrary maximum. Four intervals is what the design
  // reference draws and is enough to read a column against without crowding.
  const magnitude = Math.pow(10, Math.max(0, String(Math.ceil(max / 4)).length - 1));
  const step = Math.ceil(max / 4 / magnitude) * magnitude;
  const top = step * 4;
  const PLOT = 176;

  return (
    <div className={cn("overflow-x-auto pt-5", className)}>
      <div className="flex">
        {/* The y-axis: a tick per gridline, bottom-aligned with the baseline.
            The columns keep their printed numbers as well -- height is still
            never the only channel carrying a value. */}
        <div className="relative w-10 shrink-0" style={{ height: `${PLOT}px` }} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              // fg-muted, not fg-subtle: an axis label has to be readable, and
              // subtle measures 2.56:1 on white against the 4.5 AA needs.
              className="text-fg-muted absolute right-2 -translate-y-1/2 text-[10px] tabular-nums"
              style={{ top: `${PLOT - (i * PLOT) / 4}px` }}
            >
              {i * step}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="border-line relative border-b" style={{ height: `${PLOT}px` }}>
            {/* Behind the columns: z-0 against the z-10 below, because an
                absolutely positioned element otherwise paints over the
                in-flow bars and draws lines across them. */}
            <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="border-line-subtle absolute inset-x-0 border-t"
                  style={{ top: `${PLOT - (i * PLOT) / 4}px` }}
                />
              ))}
            </div>

            <div className="absolute inset-0 z-10 flex items-end justify-center gap-3">
              {data.map((row) => {
                // A floor of 4px so a year with a single student is still
                // visibly a column rather than a hairline that reads as zero.
                const height = Math.max((row.count / top) * PLOT, 4);
                return (
                  <div key={row.label} className="relative h-full min-w-12 max-w-20 flex-1">
                    <div
                      className="bg-primary absolute inset-x-0 bottom-0 rounded-t"
                      style={{ height: `${height}px` }}
                      title={`${row.label}: ${row.count}`}
                    />
                    <span
                      className="text-fg absolute inset-x-0 text-center text-xs font-bold tabular-nums"
                      style={{ bottom: `${height + 4}px` }}
                    >
                      {row.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center gap-3">
            {data.map((row) => (
              <span key={row.label} className="text-fg-muted min-w-12 max-w-20 flex-1 pt-1.5 text-center text-xs whitespace-nowrap">
                {row.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
