import type { GradeSheetData } from "@/lib/gradesheet/gradeSheet";

/**
 * The Student Grade Sheet as a printed document.
 *
 * Three things make this file unlike every other component in the app, all
 * of them deliberate:
 *
 *  1. IT DOES NOT USE THE APP'S THEME TOKENS. This is letterhead -- a
 *     purple-and-gold document that has to look identical on screen, on
 *     paper, in light mode and in dark mode. Theme tokens exist so the
 *     interface can change with the viewer; a printed record must not.
 *     Every colour here is a literal from the College's own sheet, held in
 *     one `--gs-*` block at the top so they are still declared once.
 *  2. IT DOES ITS OWN LAYOUT IN CSS, not Tailwind utilities, for the same
 *     reason: fixed millimetre dimensions, an A4 page box, and rules that
 *     must survive `@media print` without a utility-class cascade to
 *     reason about.
 *  3. IT IS PURE. Every figure arrives pre-computed and pre-formatted from
 *     getGradeSheet(); this file does no arithmetic and no rounding, so
 *     what is printed is exactly what the GPA engine calculated.
 *
 * `print-color-adjust: exact` is what keeps the purple bands from being
 * helpfully dropped by the browser's "save ink" default -- without it the
 * card headers print as white text on white paper.
 */

const CSS = `
.gs {
  --gs-purple: #5e2b8c;
  --gs-purple-dark: #3f1d63;
  --gs-purple-tint: #efe8f7;
  --gs-gold: #b8860b;
  --gs-gold-light: #e6c86a;
  --gs-divider: #cbb8de;
  --gs-text: #2a2135;
  --gs-muted: #6b5a7d;
  --gs-gpa-highlight: #f7ead0;
  /* White paper. The reference mock had a cream ground; on a real printer
     that is either ignored or eats a cartridge, and the purple/gold marks
     read cleaner on white anyway. */
  --gs-paper: #ffffff;

  /* A4 landscape. The sheet is wide rather than tall so the courses table
     and the three summary cards each get real width, and the whole document
     lands on one page with margins that are not apologetic. */
  width: 297mm;
  /* One millimetre under the page box. At exactly 210mm a sub-pixel
     rounding in either direction tips the sheet onto a second page, and a
     grade sheet whose signature block prints on page two is not a grade
     sheet. */
  min-height: 209mm;
  margin: 0 auto;
  padding: 7mm 10mm;
  box-sizing: border-box;
  background: var(--gs-paper);
  color: var(--gs-text);
  font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 9.5pt;
  line-height: 1.25;
  /* A single purple rule inset from the trim. The gold double frame that
     used to sit outside it is gone: two concentric borders competed with
     the letterhead for the eye, and the outer one was the first thing a
     cheap printer clipped. */
  outline: 1px solid var(--gs-purple);
  outline-offset: -4mm;
  /* The watermark is positioned against this box. */
  position: relative;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

.gs * { box-sizing: border-box; }

/* ---- Letterhead ---- */
/* A grid, not flex: the two seal columns are a fixed physical size and the
   title column is exactly what is left, so the name can be sized to fit a
   known width instead of overflowing a flex item that has no fixed share. */
/* The seals flank the wordmark rather than sitting out at the page edges --
   a centred row, so the mark and the name read as one masthead. */
.gs-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8mm;
  padding: 0 3mm 1.5mm;
}
/* The seal artwork is a PNG on a white ground, and the sheet's paper is
   cream -- multiply drops the white square into the paper without needing
   a second, alpha-cut copy of the asset. */
.gs-seal { width: 20mm; height: 20mm; flex: 0 0 auto; object-fit: contain; mix-blend-mode: multiply; }
.gs-titles { text-align: center; min-width: 0; flex: 0 1 auto; }
.gs-college {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 16pt;
  letter-spacing: 0.01em;
  color: var(--gs-purple);
  margin: 0;
  /* Kept on one line, so a longer institution name would be visibly wrong
     rather than silently reflowing the letterhead. */
  white-space: nowrap;
}
.gs-address {
  font-family: "DejaVu Serif", Georgia, serif;
  font-style: italic;
  font-size: 8.5pt;
  color: var(--gs-purple-dark);
  margin: 0.6mm 0 0;
}
.gs-rule { height: 1px; background: var(--gs-gold); margin: 1.2mm auto; width: 62%; }
.gs-subtitle {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 11pt;
  color: var(--gs-purple-dark);
  text-decoration: underline;
  text-underline-offset: 3px;
  margin: 0;
}

/* ---- Cards ---- */
.gs-card { border: 1px solid var(--gs-divider); background: #ffffff; margin-bottom: 2.5mm; }
.gs-card-head {
  background: var(--gs-purple);
  color: #ffffff;
  font-weight: 700;
  font-size: 8pt;
  letter-spacing: 0.06em;
  padding: 1.1mm 3mm;
  text-transform: uppercase;
}

/* ---- Student information: two columns, ruled like the reference ---- */
.gs-info { width: 100%; border-collapse: collapse; }
.gs-info td { border: 1px solid var(--gs-divider); padding: 1.1mm 2.5mm; vertical-align: top; }
.gs-info .gs-label { color: var(--gs-purple); font-weight: 700; width: 26mm; white-space: nowrap; }
.gs-info .gs-value { width: 44mm; }

/* ---- Courses ---- */
.gs-courses { width: 100%; border-collapse: collapse; }
.gs-courses thead th {
  background: var(--gs-purple-dark);
  color: #ffffff;
  font-size: 8pt;
  font-weight: 700;
  text-align: center;
  padding: 1.1mm 2mm;
  border: 1px solid var(--gs-divider);
}
.gs-courses thead th:first-child { text-align: left; }
.gs-courses td {
  border: 1px solid var(--gs-divider);
  padding: 1mm 2mm;
  text-align: center;
  font-size: 8.5pt;
}
.gs-courses td:first-child { text-align: left; }
.gs-courses tbody tr:nth-child(even) { background: var(--gs-purple-tint); }
.gs-empty { text-align: center; color: var(--gs-muted); font-style: italic; padding: 6mm; }

/* ---- The three bottom cards ---- */
/* Three equal-height cards. Stretching them alone matched their heights
   but left the two short ones with the tall one's empty space at the
   bottom; centring each body inside its own card is what makes the row
   read as three cards rather than one tall one and two stubs. */
.gs-bottom { display: flex; gap: 3mm; align-items: stretch; margin-bottom: 3mm; }
.gs-bottom > * { display: flex; flex-direction: column; }
.gs-standing { flex: 0 0 29%; border-color: var(--gs-gold); }
.gs-scale { flex: 1 1 auto; }
.gs-summary { flex: 0 0 30%; }
.gs-card-body { padding: 2mm 3mm; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }

.gs-standing .gs-card-body { background: var(--gs-purple-tint); text-align: center; }
.gs-standing-label { font-size: 12pt; font-weight: 700; color: var(--gs-purple-dark); margin: 0; }
.gs-standing-note { font-size: 8pt; color: var(--gs-muted); margin: 1mm 0 0; }

.gs-scale-table { width: 100%; border-collapse: collapse; font-size: 7pt; }
/* Every cell on one line: a wrapped "95 –" over "100" turned a ten-row
   reference card into a twenty-row column twice the height of its
   neighbours. */
.gs-scale-table td { padding: 0.15mm 1mm; white-space: nowrap; }
.gs-scale-table .gs-scale-letter { font-weight: 700; color: var(--gs-purple); width: 7mm; }
.gs-scale-table .gs-scale-range { width: 20mm; }
.gs-scale-table .gs-scale-points { text-align: right; width: 11mm; }
.gs-scale-table .gs-scale-desc { color: var(--gs-muted); padding-left: 3mm; }

.gs-summary-row { display: flex; justify-content: space-between; gap: 3mm; font-size: 8.5pt; padding: 0.6mm 0; margin: 0; }
.gs-summary-row strong { font-variant-numeric: tabular-nums; }
.gs-gpa {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 3mm;
  background: var(--gs-gpa-highlight);
  padding: 1.5mm 2mm;
  margin-top: 1.5mm;
}
.gs-gpa-label { font-weight: 700; font-size: 8.5pt; color: var(--gs-purple-dark); letter-spacing: 0.03em; white-space: nowrap; }
.gs-gpa-value { font-weight: 700; font-size: 14pt; color: var(--gs-purple-dark); }

/* ---- Signature block ---- */
.gs-signatures { margin-top: 4mm; }
.gs-sign-line { border-bottom: 1px solid var(--gs-text); min-width: 52mm; height: 4.5mm; }
/* Signed at the left margin, Approved at the right -- and "right" is the
   content width, so the block lines up with the table above it instead of
   drifting past its edge. */
.gs-sign-row { display: flex; gap: 8mm; align-items: flex-end; justify-content: space-between; margin-bottom: 3mm; }
.gs-sign-block { flex: 0 0 auto; max-width: 46%; }
.gs-sign-block--right { text-align: right; }
.gs-sign-block--right .gs-sign-field { justify-content: flex-end; }
.gs-sign-field { display: flex; align-items: flex-end; gap: 2mm; }
.gs-sign-caption { text-align: center; font-size: 8.5pt; margin-top: 1mm; }
.gs-sign-name { font-weight: 700; }
.gs-sign-title { color: var(--gs-muted); font-size: 8pt; }

.gs-footer-rule { height: 1px; background: var(--gs-gold-light); margin: 2.5mm 0 1.5mm; }
.gs-note { font-family: "DejaVu Serif", Georgia, serif; font-style: italic; font-size: 8pt; color: var(--gs-muted); text-align: center; margin: 0; }

/* ---- Watermark ---- */
/* The seal, very faint, over the whole sheet -- above the cards rather
   than behind them, because every card paints its own white ground and a
   mark behind them would only show in the gaps between.
   6% is the whole trick: enough to read as the College's paper when you
   hold it up, not enough to fight a grade for legibility. It is inert --
   pointer-events: none so it never eats a click on screen, and it
   carries print-color-adjust: exact so the browser's "save ink" default
   does not helpfully drop the one thing that marks the sheet as genuine. */
.gs-watermark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}
.gs-watermark img {
  width: 135mm;
  height: 135mm;
  object-fit: contain;
  opacity: 0.06;
  mix-blend-mode: multiply;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

/* ---- A long semester ---- */
/* The sheet is sized so an ordinary semester reads comfortably. A semester
   with many courses would push the signature block onto a second page, so
   past a threshold the document tightens rather than spills: smaller seals,
   tighter rows, a denser grading scale. CSS cannot count rows, so the
   component adds this class -- the alternative is sizing every sheet for
   the worst case, which makes the common five-course sheet look starved.
   The institution caps a semester at 21 credits, so twelve rows is past
   anything a plan can produce; beyond that the table's repeating header
   takes over and a second page is the honest answer. */
.gs--dense .gs-header { padding-bottom: 1mm; }
.gs--dense .gs-seal { width: 16mm; height: 16mm; }
.gs--dense .gs-college { font-size: 14pt; }
.gs--dense .gs-address { font-size: 8pt; }
.gs--dense .gs-subtitle { font-size: 10pt; }
.gs--dense .gs-rule { margin: 0.9mm auto; }
.gs--dense .gs-card { margin-bottom: 2mm; }
.gs--dense .gs-info td { padding: 0.7mm 2.5mm; }
.gs--dense .gs-courses thead th { padding: 0.7mm 2mm; font-size: 7.5pt; }
.gs--dense .gs-courses td { padding: 0.5mm 2mm; font-size: 7.8pt; }
.gs--dense .gs-bottom { margin-bottom: 2mm; }
.gs--dense .gs-card-body { padding: 1.4mm 3mm; }
.gs--dense .gs-scale-table { font-size: 6.3pt; }
.gs--dense .gs-standing-label { font-size: 11pt; }
.gs--dense .gs-gpa-value { font-size: 13pt; }
.gs--dense .gs-signatures { margin-top: 2.5mm; }
.gs--dense .gs-sign-line { height: 3.5mm; }
.gs--dense .gs-sign-row { margin-bottom: 2mm; }
.gs--dense .gs-footer-rule { margin: 1.5mm 0 1mm; }

/* ---- Print ---- */
@media print {
  @page { size: A4 landscape; margin: 0; }
  .gs { margin: 0; box-shadow: none; }
  /* A long semester can spill onto a second sheet; when it does, the
     course table repeats its header rather than orphaning bare rows. */
  .gs-courses thead { display: table-header-group; }
  .gs-courses tr { break-inside: avoid; }
  .gs-bottom, .gs-signatures { break-inside: avoid; }
}

@media screen and (max-width: 310mm) {
  /* On a phone the fixed A4 width would force a horizontal page scroll.
     Scaling the whole sheet keeps the layout honest -- it still looks like
     the page that will come out of the printer, just smaller. */
  .gs-scale-outer { overflow-x: auto; }
}
`;

function InfoRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
}: {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
}) {
  return (
    <tr>
      <td className="gs-label">{leftLabel}:</td>
      <td className="gs-value">{leftValue}</td>
      <td className="gs-label">{rightLabel}:</td>
      <td className="gs-value">{rightValue}</td>
    </tr>
  );
}

export function GradeSheetDocument({ data, sealSrc = "/lcc-logo.png" }: { data: GradeSheetData; sealSrc?: string }) {
  const { student, summary, standing, signatories } = data;
  // Measured, not guessed: at the sizes above, eight course rows is where
  // the signature block starts reaching for a second page.
  const dense = data.courses.length > 7;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <article className={dense ? "gs gs--dense" : "gs"}>
        <div className="gs-watermark" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed
              physical size on a print document; next/image's responsive
              srcset machinery has nothing to contribute here. */}
          <img src={sealSrc} alt="" />
        </div>

        <header className="gs-header">
          {/* Two seals, one image file used twice -- `public/lcc-logo.png`
              is the only seal artwork this project has, and the reference
              sheet's left and right seals are the same mark. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed
              physical dimensions on a print document; next/image's
              responsive srcset machinery has nothing to contribute and its
              wrapper interferes with the millimetre layout. */}
          <img className="gs-seal" src={sealSrc} alt="" aria-hidden="true" />
          <div className="gs-titles">
            <h1 className="gs-college">LIBERIA CHRISTIAN COLLEGE</h1>
            <p className="gs-address">5th Street, Sinkor &amp; Dixville, Monrovia, Liberia</p>
            <div className="gs-rule" />
            <p className="gs-subtitle">STUDENT GRADE SHEET</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img className="gs-seal" src={sealSrc} alt="" aria-hidden="true" />
        </header>

        <section className="gs-card">
          <h2 className="gs-card-head">Student Information</h2>
          <table className="gs-info">
            <tbody>
              <InfoRow leftLabel="Student Name" leftValue={student.name} rightLabel="College" rightValue={student.college} />
              <InfoRow leftLabel="Student ID" leftValue={student.studentNumber} rightLabel="Major" rightValue={student.major} />
              <InfoRow leftLabel="Status" leftValue={student.status} rightLabel="Minor" rightValue={student.minor} />
              <InfoRow
                leftLabel="Year"
                leftValue={data.academicYearLabel}
                rightLabel="Semester"
                rightValue={data.semesterNumeral}
              />
            </tbody>
          </table>
        </section>

        <section className="gs-card">
          <h2 className="gs-card-head">Semester Courses &amp; Results</h2>
          <table className="gs-courses">
            <thead>
              <tr>
                <th>Course Title</th>
                <th>Code</th>
                <th>Cr/Hrs</th>
                <th>Grade</th>
                <th>Grade Point</th>
                <th>Grade Points</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.length === 0 ? (
                <tr>
                  <td className="gs-empty" colSpan={6}>
                    No results are recorded for this semester.
                  </td>
                </tr>
              ) : (
                data.courses.map((c, i) => (
                  <tr key={`${c.code}-${i}`}>
                    <td>
                      {c.title}
                      {/* GRADING_RULES.md §5: an earlier attempt stays on the
                          record, marked, and is excluded from the CGPA. */}
                      {c.isRepeatDropped && " (R)"}
                    </td>
                    <td>{c.code}</td>
                    <td>{c.creditHours}</td>
                    <td>{c.letter}</td>
                    <td>{c.gradePoint ?? "—"}</td>
                    <td>{c.gradePoints ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <div className="gs-bottom">
          <section className="gs-card gs-standing">
            <h2 className="gs-card-head">Academic Standing</h2>
            <div className="gs-card-body">
              <p className="gs-standing-label">{standing.label ?? "NOT AVAILABLE"}</p>
              <p className="gs-standing-note">{standing.note}</p>
            </div>
          </section>

          <section className="gs-card gs-scale">
            <h2 className="gs-card-head">Grading System</h2>
            <div className="gs-card-body">
              <table className="gs-scale-table">
                <tbody>
                  {data.gradingScale.map((row) => (
                    <tr key={row.letter}>
                      <td className="gs-scale-letter">{row.letter}</td>
                      <td className="gs-scale-range">= {row.range}</td>
                      <td className="gs-scale-points">{row.gradePoint}</td>
                      <td className="gs-scale-desc">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="gs-card gs-summary">
            <h2 className="gs-card-head">Semester Summary</h2>
            <div className="gs-card-body">
              <p className="gs-summary-row">
                <span>Total Semester Credits</span>
                <strong>{summary.totalCredits}</strong>
              </p>
              <p className="gs-summary-row">
                <span>Credits Earned</span>
                <strong>{summary.creditsEarned}</strong>
              </p>
              <p className="gs-summary-row">
                <span>Total Grade Points</span>
                <strong>{summary.totalGradePoints}</strong>
              </p>
              <p className="gs-gpa">
                <span className="gs-gpa-label">SEMESTER GPA</span>
                {/* Null is a real answer, not zero: "nothing to calculate"
                    and "attempted everything and failed" are different
                    things (GRADING_RULES.md §3). */}
                <span className="gs-gpa-value">{summary.gpa ?? "—"}</span>
              </p>
            </div>
          </section>
        </div>

        <div className="gs-signatures">
          <div className="gs-sign-row">
            <div className="gs-sign-block">
              <div className="gs-sign-field">
                <span>Signed:</span>
                <span className="gs-sign-line" />
              </div>
              <p className="gs-sign-caption">
                <span className="gs-sign-name">{signatories.signedName}</span>
                <br />
                <span className="gs-sign-title">{signatories.signedTitle}</span>
              </p>
            </div>
            <div className="gs-sign-block gs-sign-block--right">
              <div className="gs-sign-field">
                <span>Approved:</span>
                <span className="gs-sign-line" />
              </div>
              <p className="gs-sign-caption">
                <span className="gs-sign-name">{signatories.approvedName}</span>
                <br />
                <span className="gs-sign-title">{signatories.approvedTitle}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="gs-footer-rule" />
        <p className="gs-note">
          {/* The provisional badge follows the same rule as everywhere else
              in the app (GRADING_RULES.md §9) -- and matters most here,
              because this is the copy that leaves the building. */}
          {data.isProvisional
            ? "Provisional — based on the records entered for this student so far."
            : "Issued by the Office of Admissions & Records, Liberia Christian College."}
        </p>
      </article>
    </>
  );
}
