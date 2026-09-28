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

/** The tinted icon chips on the stat cards. Colour here says something or
 * nothing: every tile wears the brand chip, and only a figure that IS a
 * status takes that status's colour -- "Active" is green because ACTIVE is
 * green on the status chart below it and on every badge in the app. There
 * used to be four tones handed out one per tile purely so the row looked
 * varied; a colour that means nothing teaches the reader to ignore colour,
 * which is exactly what the status colours need them not to do. The icon
 * and the label tell the tiles apart. */
export type StatTone = "brand" | "success";

const STAT_CHIP: Record<StatTone, string> = {
  brand: "bg-brand-subtle-strong text-brand-fg",
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
    <div className="border-line bg-surface flex items-start gap-3.5 rounded-2xl border p-4 shadow-card sm:p-5">
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

/** Gender is identity, not status, so it takes categorical colours rather
 *  than the status tokens: orange and orchid, validated as a pair for
 *  colour-vision separation on both the light and the dark card surface.
 *  "Not recorded" is missing data rather than a third group, so it stays
 *  neutral grey -- the same reason INACTIVE is grey on the status chart. */
const GENDER_COLOR: Record<string, string> = {
  Female: "var(--chart-female)",
  Male: "var(--chart-male)",
};

/**
 * A ring of parts adding up to a whole, the total in its centre and a
 * legend beside it carrying every name, count and share.
 *
 * Right for a few parts only -- here three -- where "how is the whole
 * split" is the question. The legend is the relief for colour: each part is
 * named and numbered in text, so the ring never has to be decoded by hue
 * alone, and it doubles as the table view. Every segment also carries a
 * native hover title.
 *
 * Plain SVG, server-rendered: a circle per segment drawn with a dash of its
 * share of the circumference, a surface-coloured gap between neighbours,
 * rounded ends like the bars above.
 */
export function DonutChart({
  data,
  colorFor,
  totalLabel = "Total",
  emptyMessage = "No data yet.",
}: {
  data: CountByLabel[];
  colorFor: (label: string) => string;
  totalLabel?: string;
  emptyMessage?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return <p className="text-sm text-fg-muted">{emptyMessage}</p>;

  const SIZE = 176;
  const STROKE = 16;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  // The visible space between two segments. Round caps reach half a stroke
  // past each end of a dash, so the dash is shortened by a full stroke on
  // top of the gap to keep that space clear.
  const GAP = 6;
  const parts = data.filter((d) => d.count > 0);
  const single = parts.length === 1;

  const lengths = parts.map((d) => (d.count / total) * circumference);
  const segments = parts.map((d, i) => {
    const before = lengths.slice(0, i).reduce((a, b) => a + b, 0);
    const dash = single ? circumference : Math.max(lengths[i] - GAP - STROKE, 0.001);
    const start = single ? 0 : before + (GAP + STROKE) / 2;
    return { ...d, dash, start };
  });
  // Whole percentages that add up to exactly 100: round each share down,
  // then hand the leftover points to the largest remainders. Rounding each
  // share on its own can print 46% + 42% + 13% = 101% beside one total.
  const floors = data.map((d) => Math.floor((d.count / total) * 100));
  let leftover = 100 - floors.reduce((a, b) => a + b, 0);
  const byRemainder = data
    .map((d, i) => ({ i, rem: (d.count / total) * 100 - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of byRemainder) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  const share = new Map(data.map((d, i) => [d.label, floors[i]]));
  const percent = (count: number, label: string) => `${share.get(label) ?? Math.round((count / total) * 100)}%`;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${totalLabel} ${total}: ${data.map((d) => `${d.label} ${d.count}`).join(", ")}`}
          className="-rotate-90"
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="var(--surface-subtle)" strokeWidth={STROKE} />
          {segments.map((s) => (
            <circle
              key={s.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={r}
              fill="none"
              stroke={colorFor(s.label)}
              strokeWidth={STROKE}
              strokeLinecap={single ? "butt" : "round"}
              strokeDasharray={`${s.dash} ${circumference}`}
              strokeDashoffset={-s.start}
            >
              <title>{`${s.label}: ${s.count} (${percent(s.count, s.label)})`}</title>
            </circle>
          ))}
        </svg>
        {/* The total, on a soft raised disc like the reference's centre. */}
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="bg-surface shadow-card border-line-subtle flex h-[7.25rem] w-[7.25rem] flex-col items-center justify-center rounded-full border">
            <span className="text-fg-muted text-xs">{totalLabel}</span>
            <span className="text-fg text-2xl font-extrabold tabular-nums">{total}</span>
          </div>
        </div>
      </div>

      <ul className="flex w-full min-w-0 flex-col gap-3 sm:w-auto sm:flex-1">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: colorFor(d.label) }} aria-hidden="true" />
            <span className="text-fg-secondary min-w-0 flex-1 truncate text-sm">{d.label}</span>
            <span className="text-fg text-sm font-semibold tabular-nums">{d.count}</span>
            <span className="text-fg-muted w-10 text-right text-xs tabular-nums">{percent(d.count, d.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The gender split as a ring. */
export function GenderDonut({ data }: { data: CountByLabel[] }) {
  return (
    <DonutChart
      data={data}
      colorFor={(label) => GENDER_COLOR[label] ?? "var(--fg-subtle)"}
      totalLabel="Total"
      emptyMessage="No students are enrolled yet."
    />
  );
}
