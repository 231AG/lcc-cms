import { COLLEGE_MOTTO } from "@/lib/college";
import { BOX_LINE_MM, FIRST_PAGE_TOP_MM, layoutTranscript, type LayoutPage } from "@/lib/transcript/layout";
import type { TranscriptData, TranscriptField, TranscriptSemester } from "@/lib/transcript/transcript";

/**
 * The Academic Transcript as a printed document: A4 landscape, every
 * semester the student has results in, closed by the cumulative summary,
 * the grading key and the certification block.
 *
 * Built the same way as the one-semester grade sheet, for the same reasons
 * (see GradeSheetDocument): literal letterhead colours rather than theme
 * tokens, its own millimetre CSS rather than utilities, and no arithmetic
 * -- every figure arrives formatted from getTranscript().
 *
 * The pages are laid out here, not by the browser's page breaks, so each
 * one can say "Page X of Y" (src/lib/transcript/layout.ts). Every page
 * ends with a footnote naming the student, so a loose sheet can always be
 * matched to its record.
 *
 * `unofficial` is the student's own copy: the same record, marked
 * UNOFFICIAL across every page, with no signature line and a statement
 * that it is not the College's certified copy.
 */

const CSS = `
.tr {
  --tr-purple: #5e2b8c;
  --tr-purple-dark: #3f1d63;
  --tr-heading: #4b1f87;
  --tr-tint: #efe7fa;
  --tr-tint-faint: #faf7fd;
  --tr-line: #c9b6e0;
  --tr-line-faint: #f0e9f8;
  --tr-gold: #d9a520;
  --tr-gold-frame: #e2b23a;
  --tr-gpa: #fbf3df;
  --tr-text: #2a2135;
  --tr-muted: #4a3d5a;
  --tr-label: #5b4a8a;
  --tr-void: #9b1c1c;
  display: flex;
  flex-direction: column;
  gap: 6mm;
  align-items: center;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.tr * { box-sizing: border-box; }
.tr-page {
  position: relative;
  width: 297mm;
  /* A millimetre under the page box, as on the grade sheet: at exactly
     210mm a rounding error tips each page onto two sheets. Min, not fixed:
     if an estimate in layout.ts were ever short, the page grows and prints
     its overflow rather than hiding a grade. */
  min-height: 209mm;
  padding: 6mm 9mm 3mm;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: var(--tr-text);
  font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 7.3pt;
  line-height: 1.22;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.tr-page > *:not(.tr-wm):not(.tr-void) { position: relative; z-index: 1; }

/* The seal behind everything, faint enough that text printed over it
   stays fully legible. */
.tr-wm {
  position: absolute; left: 50%; top: 55%; z-index: 0;
  width: 130mm; height: 130mm; object-fit: contain;
  transform: translate(-50%, -50%);
  opacity: 0.07; pointer-events: none;
  mix-blend-mode: multiply;
}
/* The student's copy: UNOFFICIAL across the page, above the record so it
   cannot be covered or cropped out, light enough to read through. */
.tr-void {
  position: absolute; left: 50%; top: 52%; z-index: 3;
  transform: translate(-50%, -50%) rotate(-28deg);
  font: 700 92pt/1 "DejaVu Sans", system-ui, sans-serif;
  letter-spacing: 0.12em;
  color: var(--tr-void);
  opacity: 0.13;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}

/* ---- Letterhead ---- */
.tr-head {
  border: 1.5px solid var(--tr-purple);
  display: flex; justify-content: center; align-items: center; gap: 7mm;
  padding: 1.6mm 6mm 1.4mm;
}
.tr-head img { width: 20mm; height: 20mm; object-fit: contain; flex: none; mix-blend-mode: multiply; }
.tr-head-mid { text-align: center; min-width: 0; }
.tr-college {
  margin: 0;
  font: 700 21pt/1 Georgia, "DejaVu Serif", serif;
  font-variant: small-caps; letter-spacing: 0.02em;
  color: var(--tr-purple-dark);
  white-space: nowrap;
}
.tr-motto { margin: 1.2mm 0 0; font: italic 9pt Georgia, "DejaVu Serif", serif; color: var(--tr-muted); }
.tr-addr { margin: 0.2mm 0 0; font: 9pt Georgia, "DejaVu Serif", serif; color: var(--tr-muted); }
.tr-rule { height: 0.8mm; width: 62%; background: var(--tr-gold); margin: 1.2mm auto 1mm; }
.tr-title { margin: 0; font: 700 11pt Georgia, "DejaVu Serif", serif; letter-spacing: 0.42em; color: var(--tr-purple-dark); }

.tr-runhead {
  display: flex; align-items: center; justify-content: space-between; gap: 4mm;
  border-bottom: 1.5px solid var(--tr-purple); padding-bottom: 1.6mm;
}
.tr-runhead-l { display: flex; align-items: center; gap: 3mm; }
.tr-runhead img { width: 11mm; height: 11mm; object-fit: contain; mix-blend-mode: multiply; }
.tr-runhead b { font: 700 12pt Georgia, "DejaVu Serif", serif; color: var(--tr-purple-dark); }
.tr-runhead span { color: #6b5a7d; font-size: 8pt; }

/* ---- Name line and information boxes ---- */
.tr-who {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 4mm;
  margin: 1.8mm 0 1.6mm; font-family: Georgia, "DejaVu Serif", serif;
}
.tr-who h2 { margin: 0; font: 700 15pt/1.1 Georgia, "DejaVu Serif", serif; color: var(--tr-purple-dark); overflow-wrap: anywhere; min-width: 0; }
.tr-who span { font-size: 11pt; color: var(--tr-purple-dark); }
.tr-who .tr-sep { color: #6b5a7d; }
.tr-boxes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3mm; }
.tr-box, .tr-panel { border: 1px solid var(--tr-line); border-radius: 1mm; overflow: hidden; }
.tr-box h4, .tr-panel h4 {
  margin: 0; padding: 0.7mm 2.4mm;
  background: var(--tr-tint); border-bottom: 1px solid var(--tr-line);
  font: 700 8.8pt Georgia, "DejaVu Serif", serif; letter-spacing: 0.04em;
  color: var(--tr-heading); text-transform: uppercase;
}
.tr-kv { width: 100%; border-collapse: collapse; margin: 0.4mm 0; }
.tr-kv td { padding: 0.42mm 2.4mm; border-bottom: 1px solid var(--tr-line-faint); vertical-align: top; }
.tr-kv tr:last-child td { border-bottom: 0; }
.tr-kv .tr-k { color: var(--tr-label); white-space: nowrap; width: 1%; }
/* A long address or school name wraps inside its own box. */
.tr-kv .tr-v { text-align: right; font-weight: 700; overflow-wrap: anywhere; }

/* ---- The record ---- */
.tr-years { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 6mm; margin-top: 2mm; }
.tr-sem { margin-bottom: 1.6mm; }
.tr-sem h3 {
  margin: 0 0 0.6mm; display: flex; align-items: center; gap: 2.5mm;
  font: 700 9.6pt Georgia, "DejaVu Serif", serif; color: var(--tr-heading);
}
.tr-sem h3::after { content: ""; flex: 1; border-top: 1.5px solid #7b4fc9; }
.tr-c { width: 100%; border-collapse: collapse; border: 1px solid var(--tr-line); table-layout: fixed; }
.tr-c th {
  background: var(--tr-tint); color: var(--tr-purple-dark);
  font-size: 6.9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  text-align: left; padding: 0.45mm 1.6mm; border: 1px solid var(--tr-line);
}
.tr-c td {
  padding: 0.32mm 1.6mm;
  border-left: 1px solid #e3d8f1; border-right: 1px solid #e3d8f1; border-bottom: 1px solid var(--tr-line-faint);
}
.tr-c td:nth-child(2) { overflow-wrap: anywhere; }
.tr-c .tr-n { text-align: right; font-variant-numeric: tabular-nums; }
.tr-c .tr-g { text-align: center; }
.tr-c .tr-tot td {
  background: var(--tr-tint); text-align: center; font-weight: 700;
  color: var(--tr-purple-dark); padding: 0.5mm; border: 1px solid var(--tr-line);
}
.tr-empty { margin: 4mm 0 0; color: var(--tr-muted); font-style: italic; }

/* ---- Closing: summary, key, certification ---- */
.tr-close { margin-top: auto; }
.tr-frame {
  border: 1.5px solid var(--tr-gold-frame); border-radius: 1mm; padding: 1.4mm;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 3mm;
  background: #ffffff;
}
.tr-s { width: 100%; border-collapse: collapse; }
.tr-s td { padding: 0.3mm 2.4mm; border-bottom: 1px solid var(--tr-line-faint); }
.tr-s td:first-child { color: var(--tr-label); font-style: italic; border-right: 1px solid #e3d8f1; }
.tr-s td:last-child { text-align: center; font-weight: 600; }
.tr-s .tr-cg td { background: var(--tr-gpa); font: 700 9.6pt Georgia, "DejaVu Serif", serif; color: var(--tr-purple-dark); font-style: normal; }
.tr-k { width: 100%; border-collapse: collapse; font-size: 7.2pt; }
.tr-k th { background: var(--tr-tint-faint); color: var(--tr-label); font-weight: 600; padding: 0.4mm 1.4mm; border-bottom: 1px solid #e3d8f1; }
.tr-k td { padding: 0.12mm 1.4mm; text-align: center; border-bottom: 1px solid #f4eefa; }
.tr-k .tr-l { font-weight: 700; }
.tr-k .tr-split { border-left: 1px solid var(--tr-line); }
.tr-notes { margin: 0; padding: 0.6mm 2.4mm 0.8mm; font-size: 6.9pt; color: var(--tr-muted); }
.tr-foot {
  margin-top: 1.4mm; font-size: 7.4pt; color: var(--tr-muted);
  display: grid; grid-template-columns: minmax(0, 1fr) 60mm; gap: 12mm; align-items: end;
}
.tr-foot p { margin: 0; }
.tr-foot .tr-it { font-style: italic; color: var(--tr-purple); }
.tr-foot .tr-date { margin-top: 2.2mm; }
.tr-sign { border-top: 1px solid var(--tr-purple-dark); padding-top: 0.8mm; text-align: center; margin-bottom: 0.4mm; }

/* ---- Every page: who it belongs to, and where it falls ---- */
.tr-footnote {
  display: flex; justify-content: space-between; gap: 4mm;
  margin-top: auto; padding-top: 1mm;
  font-size: 7.2pt; color: var(--tr-muted);
}
.tr-close + .tr-footnote { margin-top: 0; }

@media print {
  @page { size: A4 landscape; margin: 0; }
  .tr { display: block; }
  .tr-page { box-shadow: none; break-after: page; }
  .tr-page:last-child { break-after: auto; }
}
`;

function Letterhead({ title, logo }: { title: string; logo: string }) {
  return (
    <header className="tr-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed physical size on a print document */}
      <img src={logo} alt="" />
      <div className="tr-head-mid">
        <h1 className="tr-college">Liberia Christian College</h1>
        <p className="tr-motto">{COLLEGE_MOTTO.replace(/\.$/, "")}</p>
        <p className="tr-addr">5th Street, Sinkor &amp; Dixville, Monrovia, Liberia</p>
        <div className="tr-rule" />
        <p className="tr-title">{title}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed physical size on a print document */}
      <img src={logo} alt="" />
    </header>
  );
}

function InfoBox({ heading, fields }: { heading: string; fields: TranscriptField[] }) {
  return (
    <div className="tr-box">
      <h4>{heading}</h4>
      <table className="tr-kv">
        <tbody>
          {fields.map((f) => (
            <tr key={f.label}>
              <td className="tr-k">{f.label}</td>
              <td className="tr-v">{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SemesterTable({ semester }: { semester: TranscriptSemester }) {
  return (
    <section className="tr-sem">
      <h3>{semester.label}</h3>
      <table className="tr-c">
        <colgroup>
          <col style={{ width: "16%" }} />
          <col />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "13%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Code</th>
            <th>Course title</th>
            <th className="tr-g">Cr/Hrs</th>
            <th className="tr-g">Grade</th>
            <th className="tr-n">Points</th>
          </tr>
        </thead>
        <tbody>
          {semester.courses.map((c, i) => (
            <tr key={`${c.code}-${i}`}>
              <td>{c.code}</td>
              <td>{c.title}</td>
              <td className="tr-g">{c.creditHours}</td>
              <td className="tr-g">{c.grade}</td>
              <td className="tr-n">{c.points ?? "—"}</td>
            </tr>
          ))}
          <tr className="tr-tot">
            <td colSpan={5}>
              Total Credit Hours: {semester.totalCredits} &nbsp;•&nbsp; Total Points: {semester.totalPoints}{" "}
              &nbsp;•&nbsp; GPA: {semester.gpa ?? "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Closing({ data, unofficial }: { data: TranscriptData; unofficial: boolean }) {
  const { summary, gradingScale, gradingNotes } = data;
  // The key in three side-by-side groups, filled down each group, so the
  // whole scale is three rows tall.
  const perGroup = Math.ceil(gradingScale.length / 3);
  const keyRows = Array.from({ length: perGroup }, (_, i) => [0, 1, 2].map((g) => gradingScale[g * perGroup + i]));

  return (
    <div className="tr-close">
      <div className="tr-frame">
        <div className="tr-panel">
          <h4>Academic Summary</h4>
          <table className="tr-s">
            <tbody>
              <tr className="tr-cg">
                <td>Cumulative GPA</td>
                <td>{summary.cgpa ?? "—"}</td>
              </tr>
              <tr>
                <td>Credit hours attempted</td>
                <td>{summary.creditsAttempted}</td>
              </tr>
              <tr>
                <td>Credit hours earned</td>
                <td>
                  {summary.creditsEarned} of {summary.graduationCreditHours}
                </td>
              </tr>
              <tr>
                <td>Total Accumulated Points</td>
                <td>{summary.totalAccumulatedPoints}</td>
              </tr>
              <tr>
                <td>Academic standing</td>
                <td>{summary.standing ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="tr-panel">
          <h4>Grading System</h4>
          <table className="tr-k">
            <thead>
              <tr>
                {[0, 1, 2].flatMap((g) => [
                  <th key={`g${g}`} className={g ? "tr-split" : undefined}>
                    Grade
                  </th>,
                  <th key={`s${g}`}>Score</th>,
                  <th key={`p${g}`}>Points</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {keyRows.map((row, i) => (
                <tr key={i}>
                  {row.flatMap((cell, g) => {
                    const split = g ? "tr-split" : "";
                    return cell
                      ? [
                          <td key={`l${g}`} className={`tr-l ${split}`.trim()}>
                            {cell.letter}
                          </td>,
                          <td key={`r${g}`}>{cell.range}</td>,
                          <td key={`p${g}`}>{cell.gradePoint}</td>,
                        ]
                      : [<td key={`l${g}`} className={split || undefined} />, <td key={`r${g}`} />, <td key={`p${g}`} />];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tr-notes">
            {gradingNotes.map((n, i) => (
              <span key={n.mark}>
                {i > 0 && <> &nbsp;•&nbsp; </>}
                <b>{n.mark}</b> {n.meaning}
              </span>
            ))}
          </p>
        </div>
      </div>
      {unofficial ? (
        <div className="tr-foot">
          <div>
            <p>
              Unofficial copy, printed by the student from the LCC e-Portal. It is not a certified transcript. An
              official copy is issued by the College, signed by the {data.signatoryTitle} and sealed.
            </p>
            <p className="tr-date">Printed: {data.issuedOn}</p>
          </div>
        </div>
      ) : (
        <div className="tr-foot">
          <div>
            <p>
              A facsimile of this record constitutes an official transcript when signed by the {data.signatoryTitle}{" "}
              and impressed with the seal of the College.
            </p>
            <p className="tr-it">
              Unless otherwise indicated, the student was in good standing at the time this transcript was issued.
            </p>
            <p className="tr-date">Date: {data.issuedOn}</p>
          </div>
          <div className="tr-sign">{data.signatoryTitle}</div>
        </div>
      )}
    </div>
  );
}

export function TranscriptDocument({
  data,
  unofficial = false,
  logo = "/lcc-logo.png",
  layout,
}: {
  data: TranscriptData;
  unofficial?: boolean;
  logo?: string;
  /** Precomputed pages; computed from the data when omitted. */
  layout?: LayoutPage[];
}) {
  // Group the semesters by academic year, in order -- the unit layout.ts
  // places one per column.
  const years: TranscriptSemester[][] = [];
  for (const sem of data.semesters) {
    const last = years[years.length - 1];
    if (last && last[0].academicYearId === sem.academicYearId) last.push(sem);
    else years.push([sem]);
  }
  const pages = layout ?? layoutTranscript(years.map((y) => ({ semesters: y.map(semesterLines) })), firstPageTop(data));
  const title = unofficial ? "UNOFFICIAL ACADEMIC TRANSCRIPT" : "OFFICIAL ACADEMIC TRANSCRIPT";
  const kind = unofficial ? "Unofficial Academic Transcript" : "Official Academic Transcript";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="tr">
        {pages.map((page, index) => (
          <article key={index} className="tr-page" aria-label={`Page ${index + 1} of ${pages.length}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed physical size on a print document */}
            <img className="tr-wm" src={logo} alt="" aria-hidden="true" />
            {unofficial && (
              <div className="tr-void" aria-hidden="true">
                UNOFFICIAL
              </div>
            )}
            {index === 0 ? (
              <>
                <Letterhead title={title} logo={logo} />
                <div className="tr-who">
                  <h2>{data.student.name}</h2>
                  <span className="tr-sep">|</span>
                  <span>ID {data.student.studentNumber}</span>
                  <span className="tr-sep">|</span>
                  <span>{data.student.major}</span>
                </div>
                <div className="tr-boxes">
                  <InfoBox heading="Personal" fields={data.personal} />
                  <InfoBox heading="Academic" fields={data.academic} />
                  <InfoBox heading="Admission" fields={data.admission} />
                </div>
              </>
            ) : (
              <div className="tr-runhead">
                <div className="tr-runhead-l">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed physical size on a print document */}
                  <img src={logo} alt="" />
                  <b>Liberia Christian College</b>
                </div>
                <span>{kind} (continued)</span>
              </div>
            )}
            {page.columns.length > 0 && (
              <div className="tr-years">
                {page.columns.map((column, c) => (
                  <div key={c}>
                    {column.map(([y, s]) => (
                      <SemesterTable key={years[y][s].id} semester={years[y][s]} />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {index === 0 && data.semesters.length === 0 && (
              <p className="tr-empty">No results have been recorded for this student yet.</p>
            )}
            {page.closing && <Closing data={data} unofficial={unofficial} />}
            <div className="tr-footnote">
              <span>
                {data.student.name} &nbsp;·&nbsp; ID {data.student.studentNumber}
              </span>
              <span>
                Page {index + 1} of {pages.length}
              </span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * How many printed lines a semester's courses take: a title too long for
 * the column wraps onto a second line, and layout.ts has to know.
 */
const TITLE_CHARS_PER_LINE = 44;
function semesterLines(semester: TranscriptSemester): number {
  return semester.courses.reduce((sum, c) => sum + Math.max(1, Math.ceil(c.title.length / TITLE_CHARS_PER_LINE)), 0);
}

/**
 * Page 1's letterhead and boxes, taller than usual when a value wraps.
 *
 * A value shares its row with the box's widest label (the label column is
 * as wide as its longest entry), so the room left for it is roughly a fixed
 * number of characters less that label's length -- measured, then rounded
 * so a borderline value is counted as wrapping. The Admission box has two
 * rows fewer than the others, so it has that much to spare before it is
 * the tallest.
 */
const BOX_CHARS = 54;
function boxExtraLines(fields: TranscriptField[]): number {
  const room = BOX_CHARS - Math.max(...fields.map((f) => f.label.length));
  return fields.reduce((n, f) => n + Math.max(0, Math.ceil(f.value.length / room) - 1), 0);
}
function firstPageTop(data: TranscriptData): number {
  const extra = Math.max(boxExtraLines(data.personal), boxExtraLines(data.academic), boxExtraLines(data.admission) - 2, 0);
  return FIRST_PAGE_TOP_MM + extra * BOX_LINE_MM;
}
