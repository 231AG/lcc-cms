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
  --gs-paper: #fffdf5;

  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 12mm;
  box-sizing: border-box;
  background: var(--gs-paper);
  color: var(--gs-text);
  font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  /* The gold double border and the purple inner rule of the reference
     frame, done as two nested boxes rather than a border-style: double,
     so the gap between them is a real, controllable distance. */
  border: 4px double var(--gs-gold);
  outline: 1px solid var(--gs-purple);
  outline-offset: -6mm;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

.gs * { box-sizing: border-box; }

/* ---- Letterhead ---- */
/* A grid, not flex: the two seal columns are a fixed physical size and the
   title column is exactly what is left, so the name can be sized to fit a
   known width instead of overflowing a flex item that has no fixed share. */
.gs-header {
  display: grid;
  grid-template-columns: 24mm 1fr 24mm;
  align-items: center;
  gap: 5mm;
  padding: 2mm 3mm 4mm;
}
/* The seal artwork is a PNG on a white ground, and the sheet's paper is
   cream -- multiply drops the white square into the paper without needing
   a second, alpha-cut copy of the asset. */
.gs-seal { width: 24mm; height: 24mm; object-fit: contain; mix-blend-mode: multiply; }
.gs-titles { text-align: center; min-width: 0; }
.gs-college {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 16.5pt;
  letter-spacing: 0.01em;
  color: var(--gs-purple);
  margin: 0;
  /* The reference's "must fit between the seals" rule. Sized so it fits the
     grid's middle column at A4 with room to spare, and kept on one line so
     that a longer institution name would be visibly wrong rather than
     silently reflowing the letterhead. */
  white-space: nowrap;
}
.gs-address {
  font-family: "DejaVu Serif", Georgia, serif;
  font-style: italic;
  font-size: 9.5pt;
  color: var(--gs-purple-dark);
  margin: 1mm 0 0;
}
.gs-rule { height: 1px; background: var(--gs-gold); margin: 2mm auto; width: 62%; }
.gs-subtitle {
  font-family: "DejaVu Serif", Georgia, serif;
  font-weight: 700;
  font-size: 13pt;
  color: var(--gs-purple-dark);
  text-decoration: underline;
  text-underline-offset: 3px;
  margin: 0;
}

/* ---- Cards ---- */
.gs-card { border: 1px solid var(--gs-divider); background: #ffffff; margin-bottom: 4mm; }
.gs-card-head {
  background: var(--gs-purple);
  color: #ffffff;
  font-weight: 700;
  font-size: 9pt;
  letter-spacing: 0.06em;
  padding: 1.6mm 3mm;
  text-transform: uppercase;
}

/* ---- Student information: two columns, ruled like the reference ---- */
.gs-info { width: 100%; border-collapse: collapse; }
.gs-info td { border: 1px solid var(--gs-divider); padding: 1.6mm 3mm; vertical-align: top; }
.gs-info .gs-label { color: var(--gs-purple); font-weight: 700; width: 26mm; white-space: nowrap; }
.gs-info .gs-value { width: 44mm; }

/* ---- Courses ---- */
.gs-courses { width: 100%; border-collapse: collapse; }
.gs-courses thead th {
  background: var(--gs-purple-dark);
  color: #ffffff;
  font-size: 8.5pt;
  font-weight: 700;
  text-align: center;
  padding: 1.6mm 2mm;
  border: 1px solid var(--gs-divider);
}
.gs-courses thead th:first-child { text-align: left; }
.gs-courses td {
  border: 1px solid var(--gs-divider);
  padding: 1.5mm 2mm;
  text-align: center;
  font-size: 9pt;
}
.gs-courses td:first-child { text-align: left; }
.gs-courses tbody tr:nth-child(even) { background: var(--gs-purple-tint); }
.gs-empty { text-align: center; color: var(--gs-muted); font-style: italic; padding: 6mm; }

/* ---- The three bottom cards ---- */
/* Three equal-height cards. Stretching them alone matched their heights
   but left the two short ones with the tall one's empty space at the
   bottom; centring each body inside its own card is what makes the row
   read as three cards rather than one tall one and two stubs. */
.gs-bottom { display: flex; gap: 3mm; align-items: stretch; margin-bottom: 6mm; }
.gs-bottom > * { display: flex; flex-direction: column; }
.gs-standing { flex: 0 0 29%; border-color: var(--gs-gold); }
.gs-scale { flex: 1 1 auto; }
.gs-summary { flex: 0 0 30%; }
.gs-card-body { padding: 2.5mm 3mm; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }

.gs-standing .gs-card-body { background: var(--gs-purple-tint); text-align: center; }
.gs-standing-label { font-size: 13pt; font-weight: 700; color: var(--gs-purple-dark); margin: 0; }
.gs-standing-note { font-size: 8pt; color: var(--gs-muted); margin: 1mm 0 0; }

.gs-scale-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
/* Every cell on one line: a wrapped "95 –" over "100" turned a ten-row
   reference card into a twenty-row column twice the height of its
   neighbours. */
.gs-scale-table td { padding: 0.35mm 1mm; white-space: nowrap; }
.gs-scale-table .gs-scale-letter { font-weight: 700; color: var(--gs-purple); width: 7mm; }
.gs-scale-table .gs-scale-range { width: 20mm; }
.gs-scale-table .gs-scale-points { text-align: right; width: 11mm; }
.gs-scale-table .gs-scale-desc { color: var(--gs-muted); padding-left: 3mm; }

.gs-summary-row { display: flex; justify-content: space-between; gap: 3mm; font-size: 8.5pt; padding: 0.8mm 0; margin: 0; }
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
.gs-gpa-value { font-weight: 700; font-size: 16pt; color: var(--gs-purple-dark); }

/* ---- Signature block ---- */
.gs-signatures { margin-top: 8mm; }
.gs-sign-line { border-bottom: 1px solid var(--gs-text); min-width: 52mm; height: 6mm; }
.gs-sign-row { display: flex; gap: 8mm; align-items: flex-end; margin-bottom: 6mm; }
.gs-sign-field { display: flex; align-items: flex-end; gap: 2mm; }
.gs-sign-caption { text-align: center; font-size: 8.5pt; margin-top: 1mm; }
.gs-sign-name { font-weight: 700; }
.gs-sign-title { color: var(--gs-muted); font-size: 8pt; }

.gs-footer-rule { height: 1px; background: var(--gs-gold-light); margin: 4mm 0 2mm; }
.gs-note { font-family: "DejaVu Serif", Georgia, serif; font-style: italic; font-size: 8pt; color: var(--gs-muted); text-align: center; margin: 0; }

/* ---- Print ---- */
@media print {
  @page { size: A4 portrait; margin: 0; }
  .gs { border-width: 4px; margin: 0; box-shadow: none; }
  /* A long semester can spill onto a second sheet; when it does, the
     course table repeats its header rather than orphaning bare rows. */
  .gs-courses thead { display: table-header-group; }
  .gs-courses tr { break-inside: avoid; }
  .gs-bottom, .gs-signatures { break-inside: avoid; }
}

@media screen and (max-width: 220mm) {
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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <article className="gs">
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
            <h2 className="gs-card-head">Grading Scale</h2>
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
            <div className="gs-sign-field">
              <span>Date Issued:</span>
              <span className="gs-sign-line" />
            </div>
          </div>
          <div className="gs-sign-row">
            <div>
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
            <div>
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
