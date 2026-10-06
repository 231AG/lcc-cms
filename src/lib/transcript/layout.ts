/**
 * Which semesters go on which page of the printed transcript.
 *
 * The transcript is A4 landscape with two columns of semester tables. One
 * academic year fills one column -- its Semester I above its Semester II --
 * so a reader finds a year in one place, and two years sit side by side on
 * each page. Page 1 also carries the letterhead and the three information
 * boxes; later pages carry a one-line running head instead. The Academic
 * Summary, Grading System and signature block close the last page, or get
 * a page of their own when they would not fit under the last tables.
 *
 * This is decided here, on the server, rather than left to the browser's
 * own page breaks: every page prints "Page X of Y", and only a layout that
 * is known in advance can number its pages. CSS cannot measure a table, so
 * the heights below are millimetre estimates of the document's own CSS,
 * measured from rendered pages and rounded UP -- an estimate that is too
 * large costs some white space, one that is too small would push a table
 * off the bottom of the sheet.
 *
 * Pure, with no React and no database, so it can be tested directly.
 */

// Measured in Chromium from rendered transcripts (Oct 2026), then rounded
// so each estimate is at or just above what the page actually uses.

/** Height inside the page padding, less the footnote line every page ends with. */
export const PAGE_CONTENT_MM = 195.5;
/** Letterhead, name line and the three information boxes on page 1, when no value wraps. */
export const FIRST_PAGE_TOP_MM = 70.8;
/** One more line in the tallest information box, for a value that wraps. */
export const BOX_LINE_MM = 3.2;
/** The running head on every later page. */
export const LATER_PAGE_TOP_MM = 15;
/** Heading, column header row, total row and the space below one semester table. */
export const SEMESTER_FRAME_MM = 15;
/** One printed line of the course table. A wrapped title's second line is
 *  shorter than a full row, so counting it as one errs on the safe side. */
export const COURSE_ROW_MM = 4.05;
/** Summary, grading key (notes on up to two lines), certification and signature block. */
export const CLOSING_MM = 45.5;

export interface LayoutYear {
  /** The printed course lines of each semester in the year, in order --
   *  one per course, two for a title that wraps. */
  semesters: number[];
}

/** A semester, by its position in the year list: [year index, semester index]. */
export type SemesterRef = [number, number];

export interface LayoutPage {
  /** Up to two columns, each a list of semesters stacked top to bottom. */
  columns: SemesterRef[][];
  /** True on the page that ends with the summary and signature block. */
  closing: boolean;
}

export function semesterHeight(lineCount: number): number {
  return SEMESTER_FRAME_MM + Math.max(lineCount, 1) * COURSE_ROW_MM;
}

function columnHeight(lineCounts: number[]): number {
  return lineCounts.reduce((sum, n) => sum + semesterHeight(n), 0);
}

/**
 * @param firstPageTop the height of page 1's letterhead and boxes -- more
 *   than FIRST_PAGE_TOP_MM when a long address or school name wraps.
 */
export function layoutTranscript(years: LayoutYear[], firstPageTop = FIRST_PAGE_TOP_MM): LayoutPage[] {
  const available = (pageIndex: number) => PAGE_CONTENT_MM - (pageIndex === 0 ? firstPageTop : LATER_PAGE_TOP_MM);

  const pages: { columns: SemesterRef[][]; counts: number[][] }[] = [{ columns: [], counts: [] }];

  /** A fresh column, on the current page if it has room for one more, else on a new page. */
  const newColumn = () => {
    let page = pages[pages.length - 1];
    if (page.columns.length === 2) {
      page = { columns: [], counts: [] };
      pages.push(page);
    }
    page.columns.push([]);
    page.counts.push([]);
  };

  years.forEach((year, y) => {
    newColumn();
    year.semesters.forEach((lineCount, s) => {
      const page = pages[pages.length - 1];
      const col = page.counts.length - 1;
      // A year that does not fit one column continues in the next one --
      // a very full year, not a normal one, but never cut off.
      if (page.counts[col].length > 0 && columnHeight([...page.counts[col], lineCount]) > available(pages.length - 1)) {
        newColumn();
      }
      const current = pages[pages.length - 1];
      current.columns[current.columns.length - 1].push([y, s]);
      current.counts[current.counts.length - 1].push(lineCount);
    });
  });

  // The closing block sits under the taller of the last page's columns.
  const last = pages[pages.length - 1];
  const tallest = Math.max(0, ...last.counts.map(columnHeight));
  const closingFits = tallest + CLOSING_MM <= available(pages.length - 1);

  const result: LayoutPage[] = pages.map((p) => ({ columns: p.columns, closing: false }));
  if (closingFits) result[result.length - 1].closing = true;
  else result.push({ columns: [], closing: true });
  return result;
}
