import type { ReactNode } from "react";

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
 *
 * Nothing here tries to squeeze the table onto one page: a 300-student list
 * that fits on one sheet is a list nobody can read.
 */

const CSS = `
.pr {
  --pr-purple: #5e2b8c;
  --pr-purple-dark: #3f1d63;
  --pr-tint: #efe8f7;
  --pr-gold: #b8860b;
  --pr-divider: #cbb8de;
  --pr-text: #2a2135;
  --pr-muted: #6b5a7d;

  max-width: 190mm;
  margin: 0 auto;
  color: var(--pr-text);
  font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 9.5pt;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.pr * { box-sizing: border-box; }

.pr-head { display: grid; grid-template-columns: 20mm 1fr 20mm; align-items: center; gap: 5mm; }
.pr-seal { width: 20mm; height: 20mm; object-fit: contain; mix-blend-mode: multiply; }
.pr-titles { text-align: center; min-width: 0; }
.pr-college {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 15pt;
  color: var(--pr-purple);
  margin: 0;
  white-space: nowrap;
}
.pr-address { font-family: "DejaVu Serif", Georgia, serif; font-style: italic; font-size: 8.5pt; color: var(--pr-purple-dark); margin: 0.5mm 0 0; }
.pr-rule { height: 1px; background: var(--pr-gold); margin: 2mm auto; width: 60%; }
.pr-title { font-family: "DejaVu Serif", Georgia, serif; font-weight: 700; font-size: 12pt; color: var(--pr-purple-dark); margin: 0; }
.pr-subtitle { font-size: 8.5pt; color: var(--pr-muted); margin: 1mm 0 0; }

.pr-table { width: 100%; border-collapse: collapse; margin-top: 5mm; }
.pr-table thead th {
  background: var(--pr-purple-dark);
  color: #ffffff;
  font-size: 8pt;
  text-align: left;
  padding: 1.5mm 2mm;
  border: 1px solid var(--pr-divider);
}
.pr-table td { border: 1px solid var(--pr-divider); padding: 1.2mm 2mm; font-size: 8.5pt; }
.pr-table tbody tr:nth-child(even) { background: var(--pr-tint); }
.pr-empty { text-align: center; font-style: italic; color: var(--pr-muted); padding: 8mm; }

.pr-foot { margin-top: 4mm; font-size: 7.5pt; color: var(--pr-muted); display: flex; justify-content: space-between; gap: 6mm; }

@media print {
  @page { size: A4 portrait; margin: 12mm; }
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
  columns,
  rows,
  emptyMessage = "Nothing matches these filters.",
  footNote,
  sealSrc = "/lcc-logo.png",
}: {
  title: string;
  subtitle?: string;
  columns: ReadonlyArray<{ key: string; header: string }>;
  rows: Array<Record<string, ReactNode>>;
  emptyMessage?: string;
  footNote?: string;
  sealSrc?: string;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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

        <table className="pr-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.header}</th>
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
                    <td key={c.key}>{row[c.key]}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pr-foot">
          <span>
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {footNote ? ` · ${footNote}` : ""}
          </span>
          <span>Liberia Christian College E-Portal</span>
        </div>
      </article>
    </>
  );
}
