import { Fragment, type ReactNode } from "react";

export type Orientation = "landscape" | "portrait";

/**
 * The shell every printable listing shares: the College letterhead, a title
 * and subtitle, and a long table that paginates properly across sheets.
 *
 * Same spirit as the Student Grade Sheet's header (logo, address, title) but
 * a different job: the grade sheet is one fixed-size certificate, this is an
 * unbounded list. So this one is deliberately NOT height-constrained and
 * gets the print rules a multi-page table actually needs:
 *
 *  - `thead { display: table-header-group }` repeats the column headers at
 *    the top of every printed page, so page four is still readable on its
 *    own. This is the single most important line in the file.
 *  - `break-inside: avoid` on rows, so no row is sliced in half by a page
 *    break.
 *  - `print-color-adjust: exact`, or the purple header band silently
 *    disappears under the browser's "save ink" default.
 *  - A4 LANDSCAPE. These tables are wide -- course offerings is twelve
 *    columns -- and portrait forces every cell to wrap two or three lines
 *    deep. Landscape gives each column the width it actually needs, which is
 *    the difference between a timetable you can read across and a wall of
 *    wrapped text.
 *
 * Nothing here tries to squeeze the table onto one page: a 300-student list
 * that fits on one sheet is a list nobody can read.
 */

/** A4 landscape and portrait, minus the @page margins below. */
const PAGE_WIDTH = { landscape: "273mm", portrait: "186mm" } as const;

const cssFor = (orientation: Orientation) => `
.pr {
  --pr-purple: #5e2b8c;
  --pr-purple-dark: #3f1d63;
  --pr-tint: #efe8f7;
  --pr-gold: #b8860b;
  --pr-divider: #cbb8de;
  --pr-text: #2a2135;
  --pr-muted: #6b5a7d;

  max-width: ${PAGE_WIDTH[orientation]};
  margin: 0 auto;
  color: var(--pr-text);
  font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 9.5pt;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.pr * { box-sizing: border-box; }

/* The seals sit beside the college name rather than out at the page edges:
   a centred flex row, so the three parts read as one masthead instead of
   three things spread across the width of the sheet. */
.pr-head { display: flex; align-items: center; justify-content: center; gap: 8mm; }
.pr-seal { width: 26mm; height: 26mm; flex: 0 0 auto; object-fit: contain; mix-blend-mode: multiply; }
.pr-titles { text-align: center; min-width: 0; }
.pr-college {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 17pt;
  color: var(--pr-purple);
  margin: 0;
  white-space: nowrap;
}
.pr-address { font-family: "DejaVu Serif", Georgia, serif; font-style: italic; font-size: 8.5pt; color: var(--pr-purple-dark); margin: 0.5mm 0 0; }
.pr-rule { height: 1px; background: var(--pr-gold); margin: 2mm auto; width: 60%; }
.pr-title { font-family: "DejaVu Serif", Georgia, serif; font-weight: 700; font-size: 12pt; color: var(--pr-purple-dark); margin: 0; }
.pr-subtitle { font-size: 8.5pt; color: var(--pr-muted); margin: 1mm 0 0; }

/* Centred in the page, and never wider than it. */
.pr-table { width: 100%; margin: 5mm auto 0; border-collapse: collapse; }
.pr-table thead th {
  background: var(--pr-purple-dark);
  color: #ffffff;
  font-size: 8pt;
  text-align: left;
  padding: 1.5mm 2mm;
  border: 1px solid var(--pr-divider);
}
.pr-table td { border: 1px solid var(--pr-divider); padding: 1.2mm 2mm; font-size: 8.5pt; }
/* Short columns keep to one line: "Semester I" broken over two rows is
   taller and harder to read than the two words it saves. Only the free-text
   columns (names, titles) are allowed to wrap. */
.pr-table .pr-nowrap { white-space: nowrap; }
.pr-table tbody tr:nth-child(even) { background: var(--pr-tint); }
.pr-empty { text-align: center; font-style: italic; color: var(--pr-muted); padding: 8mm; }

/* The who-this-is-about block: label and value pairs under the masthead,
   for a sheet that is about one person rather than a filtered list. Two
   columns on a wide sheet, one on a narrow one, so a portrait control
   sheet does not strand a label on its own line. */
.pr-meta { margin: 4mm auto 0; width: 100%; border-collapse: collapse; }
.pr-meta td { padding: 1mm 2mm; font-size: 9pt; border: none; }
.pr-meta .pr-meta-label { color: var(--pr-muted); white-space: nowrap; width: 1%; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.02em; }
.pr-meta .pr-meta-value { font-weight: 700; padding-right: 8mm; }

.pr-foot { margin-top: 4mm; font-size: 7.5pt; color: var(--pr-muted); display: flex; justify-content: space-between; gap: 6mm; }

@media print {
  @page { size: A4 ${orientation}; margin: 12mm; }
  /* The whole point of this component: column headers repeat on every
     printed page, and no row is cut in half by a page break. */
  .pr-table thead { display: table-header-group; }
  .pr-table tr { break-inside: avoid; }
  .pr-head { break-after: avoid; }
}
`;

export function PrintReport({
  title,
  subtitle,
  meta,
  columns,
  rows,
  emptyMessage = "Nothing matches these filters.",
  footNote,
  rowNoun = "row",
  sealSrc = "/lcc-logo.png",
  orientation = "landscape",
}: {
  title: string;
  subtitle?: string;
  /** Label/value pairs about the subject of the sheet, printed between the
   *  masthead and the table. Omitted by the filtered listings, which are
   *  about a query rather than about a person. */
  meta?: ReadonlyArray<{ label: string; value: ReactNode }>;
  columns: ReadonlyArray<{ key: string; header: string; nowrap?: boolean }>;
  rows: Array<Record<string, ReactNode>>;
  emptyMessage?: string;
  footNote?: string;
  /** Singular; pluralised with an "s". "4 rows" is the right word on a
   *  filtered listing and the wrong one on a document about courses. */
  rowNoun?: string;
  sealSrc?: string;
  /** Landscape by default: the listings this was built for are ten or more
   *  columns wide. A narrow sheet passes "portrait". */
  orientation?: Orientation;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cssFor(orientation) }} />
      <article className="pr">
        <header className="pr-head">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed
              physical size on a print document; see GradeSheetDocument. */}
          <img className="pr-seal" src={sealSrc} alt="" aria-hidden="true" />
          <div className="pr-titles">
            <p className="pr-college">LIBERIA CHRISTIAN COLLEGE</p>
            <p className="pr-address">5th Street, Sinkor &amp; Dixville, Monrovia, Liberia</p>
            <div className="pr-rule" />
            <h1 className="pr-title">{title}</h1>
            {subtitle && <p className="pr-subtitle">{subtitle}</p>}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img className="pr-seal" src={sealSrc} alt="" aria-hidden="true" />
        </header>

        {meta && meta.length > 0 && (
          <table className="pr-meta">
            <tbody>
              {/* Two pairs per row, so the block stays compact rather than
                  running down the page one field at a time. */}
              {Array.from({ length: Math.ceil(meta.length / 2) }, (_, i) => (
                <tr key={i}>
                  {[meta[i * 2], meta[i * 2 + 1]].map((cell, j) =>
                    cell ? (
                      <Fragment key={j}>
                        <td className="pr-meta-label">{cell.label}</td>
                        <td className="pr-meta-value">{cell.value}</td>
                      </Fragment>
                    ) : (
                      <Fragment key={j}>
                        <td />
                        <td />
                      </Fragment>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <table className="pr-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.nowrap ? "pr-nowrap" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="pr-empty" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.nowrap ? "pr-nowrap" : undefined}>
                      {row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pr-foot">
          <span>
            {rows.length} {rowNoun}{rows.length === 1 ? "" : "s"}
            {footNote ? ` · ${footNote}` : ""}
          </span>
          <span>Liberia Christian College E-Portal</span>
        </div>
      </article>
    </>
  );
}
