/**
 * Turning a pasted course list into rows.
 *
 * The College's catalogue exists as a PDF, and the text that comes out of
 * a PDF is not a list of lines -- it is one long ribbon where the line
 * breaks fall wherever the typesetter's column ended, mid-title as often
 * as not:
 *
 *     ACCT202 | Cost Accounting I | 3 ACCT203 | Intermediate Accounting II
 *     | 3 ACCT301 | Cost
 *     Accounting II | 3 ACCT302 | Accounting Information System | 2
 *
 * So this does NOT split on newlines. It finds where each record STARTS --
 * a course code at the head of a pipe-separated triple -- and takes
 * everything up to the next one. Newlines are whitespace like any other.
 * That single decision is what lets someone paste straight out of the
 * catalogue instead of reformatting 800 lines by hand.
 *
 * Pure: no database, no permissions, no I/O. Everything it knows about a
 * row's fate beyond "this is what it says" is decided by the caller.
 */

export interface ParsedCourse {
  /** Stored form: upper case, no spaces. */
  code: string;
  /** Exactly as pasted, trimmed. Titles are printed on grade sheets, so
   *  nothing here rewrites one. */
  title: string;
  creditHours: number;
  /** The letters at the head of the code -- ACCT, ENGL. Not a department:
   *  the caller maps these, because only the College knows which
   *  department a subject belongs to. */
  prefix: string;
  /** 1-based, counting records rather than lines, since a record may span
   *  several lines or share one. */
  position: number;
}

export interface ParseProblem {
  /** The text that could not be read, trimmed and capped for display. */
  text: string;
  reason: string;
}

export interface ParseResult {
  courses: ParsedCourse[];
  problems: ParseProblem[];
  /** Codes appearing more than once in the paste. The first occurrence is
   *  kept and listed here, because a list that silently dropped its own
   *  duplicates would hide a real disagreement in the source document. */
  duplicates: { code: string; kept: ParsedCourse; alsoSeen: ParsedCourse[] }[];
}

/**
 * Headings that end the course list.
 *
 * The extraction prompt asks for CONFLICTS, SUBJECT PREFIXES and NEEDS
 * ATTENTION below the clean rows -- courses the source document
 * contradicts itself about, and ones missing a value. Those are decisions
 * for the College, not rows to import, so the parser stops when it reaches
 * them rather than trying to make sense of prose.
 */
const TERMINATORS = ["CONFLICTS", "SUBJECT PREFIXES", "NEEDS ATTENTION"];

/** Where the record ends: the start of the next one, or the first heading
 *  that means the list is over. */
function endOfList(text: string): number {
  let end = text.length;
  for (const heading of TERMINATORS) {
    const at = text.indexOf(heading);
    if (at !== -1 && at < end) end = at;
  }
  return end;
}

/**
 * A course code: two to six letters then three or four digits, with an
 * optional space between ("ACCT 101" and "ACCT101" are the same course to
 * a reader, and both appear in the wild). A trailing letter is allowed for
 * the laboratory courses -- BIOL111L.
 */
const CODE = String.raw`[A-Za-z]{2,6}\s?\d{3,4}[A-Za-z]?`;

/**
 * One record. It ends at whichever comes first: the end of its line, the
 * start of the next record on the same line, or the end of the text.
 *
 * The end-of-line alternative matters more than it looks. Without it, one
 * unreadable line poisons the record ABOVE it: the lazy title keeps
 * growing across the newline hunting for a terminator that never comes,
 * the whole match fails, and a perfectly good course vanishes with its
 * bad neighbour. Found by a test with "MINOR | (blank) | (blank)" under a
 * real course -- which is exactly what the College's own list contains.
 */
const RECORD = new RegExp(
  String.raw`(${CODE})\s*[|\t]\s*(.*?)\s*[|\t]\s*(\d{1,2})(?=[^\S\r\n]*(?:\r?\n|$)|\s*${CODE}\s*[|\t])`,
  "gs",
);

/** Anything that looked like it wanted to be a record but was not one. */
const NEAR_MISS = /\S[^|\t\n]*[|\t][^|\t\n]*(?:[|\t][^|\t\n]*)?/g;

export function parseCourseList(input: string): ParseResult {
  const text = input.slice(0, endOfList(input)).replace(/^\s*COURSES\s*/i, "");

  const courses: ParsedCourse[] = [];
  const consumed: [number, number][] = [];

  RECORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECORD.exec(text)) !== null) {
    const code = match[1].replace(/\s+/g, "").toUpperCase();
    const title = match[2].replace(/\s+/g, " ").trim();
    const creditHours = Number(match[3]);
    consumed.push([match.index, match.index + match[0].length]);
    if (!title) continue; // handled as a problem below, via the gaps
    courses.push({
      code,
      title,
      creditHours,
      prefix: (/^[A-Z]+/.exec(code) ?? [""])[0],
      position: courses.length + 1,
    });
  }

  // Whatever the record pass did not consume: text that carries a
  // separator and so was probably meant to be a row. Reported rather than
  // dropped -- a silent importer that skips what it cannot read is how you
  // end up with 780 of 796 courses and no idea which sixteen are missing.
  const problems: ParseProblem[] = [];
  let cursor = 0;
  const gaps: string[] = [];
  for (const [start, end] of consumed) {
    if (start > cursor) gaps.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) gaps.push(text.slice(cursor));

  for (const gap of gaps) {
    NEAR_MISS.lastIndex = 0;
    let near: RegExpExecArray | null;
    while ((near = NEAR_MISS.exec(gap)) !== null) {
      const fragment = near[0].replace(/\s+/g, " ").trim();
      if (fragment.length < 3) continue;
      problems.push({
        text: fragment.length > 120 ? `${fragment.slice(0, 117)}…` : fragment,
        reason: "Not in the form CODE | TITLE | CREDITS",
      });
    }
  }

  // Duplicates inside the paste itself.
  const byCode = new Map<string, ParsedCourse[]>();
  for (const c of courses) {
    const list = byCode.get(c.code) ?? [];
    list.push(c);
    byCode.set(c.code, list);
  }
  const duplicates = [...byCode.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([code, list]) => ({ code, kept: list[0], alsoSeen: list.slice(1) }));

  const firstOnly = courses.filter((c) => byCode.get(c.code)![0] === c);

  return { courses: firstOnly, problems, duplicates };
}

/** Distinct subject prefixes, with how many courses each covers, most
 *  first. This is the mapping an Admin actually has to do. */
export function summarisePrefixes(courses: readonly ParsedCourse[]): { prefix: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of courses) counts.set(c.prefix, (counts.get(c.prefix) ?? 0) + 1);
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}
