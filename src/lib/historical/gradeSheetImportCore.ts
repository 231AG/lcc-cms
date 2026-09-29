import { courseCodeKey } from "@/lib/courses/courseCode";

/**
 * Checking a CSV of past grade sheets before any of it is imported.
 *
 * Pure: no database. gradeSheetImport.ts reads the students, semesters,
 * catalogue, grade scale and existing records into an ImportContext and
 * hands it here, so every rule below is unit-tested against fixed inputs.
 *
 * The standard is "nothing wrong goes in". A sheet is imported whole or
 * not at all, and only when every check passes -- a problem anywhere on a
 * sheet holds the whole sheet back, because a student's semester with one
 * course missing is a wrong record, not a partial one. Grades are never
 * guessed or corrected here: a value that doesn't check out is reported
 * with the CSV line it came from, for someone to settle against the paper
 * sheet.
 *
 * Two things ARE settled here, both as the College decided (29 Sep 2026)
 * and both shown on the preview before anything is saved:
 *  - The student's ID. The IDs held in the system are the right ones. When
 *    a student appears in the file under more than one ID and a sheet's ID
 *    is blank or not in the system, the sheet goes to the one record in the
 *    system that both carries the student's name and is one of the IDs the
 *    file itself uses for them. Anything less certain is held back.
 *  - A past semester missing from the Academic calendar is created, with
 *    dates copied from the calendar's own pattern for that semester.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180: quoted fields, doubled quotes, commas and line breaks inside
 *  quotes, CRLF or LF, and a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A blank line is not a record.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export const REQUIRED_COLUMNS = [
  "source_file",
  "page",
  "sheet_no",
  "student_id",
  "student_name",
  "sheet_year",
  "semester_number",
  "course_title",
  "course_number",
  "grade",
  "credit_hours",
  "grade_points",
  "sheet_gpa",
] as const;

/** Optional: fills in the catalogue code where a sheet gives a title
 *  ("Freshman English II") the catalogue can't be matched on. */
export const OPTIONAL_COLUMNS = ["course_code", "flags", "notes"] as const;

/** Extraction flags this importer re-checks for itself -- the GPA, the
 *  letter, the points, a blank ID, a course twice, a sheet with no
 *  courses. Every other flag still on a row (UNREADABLE, SEMESTER_UNCLEAR,
 *  or one added by hand to hold a row back) means someone must look at
 *  the paper first, so the row is held until the flag is cleared. */
const RECHECKED_FLAGS = new Set(["GPA_MISMATCH", "LETTER_NOT_STANDARD", "POINTS_MISMATCH", "MISSING_ID", "DUPLICATE_COURSE", "NO_COURSES"]);

// ---------------------------------------------------------------------------
// Context supplied by the database layer
// ---------------------------------------------------------------------------

export interface ScaleLetter {
  gradePoint: string | null;
  countsInGpa: boolean;
}

export interface ContextStudent {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  enrolmentYear: number;
}

export interface ContextSemester {
  id: string;
  /** "2024/2025 — Semester II" */
  label: string;
  hasEnded: boolean;
  startYear: number;
  /** For putting sheets in the order they happened. */
  sortKey: number;
}

export interface ContextCourse {
  code: string;
  title: string;
}

export interface ExistingRecord {
  semesterId: string;
  codeKey: string;
  letter: string;
}

/** An academic year in the calendar, for copying its dates to a year or
 *  semester that isn't there yet. Dates are "YYYY-MM-DD". */
export interface CalendarYear {
  label: string;
  startDate: string;
  endDate: string;
  semesters: Array<{ sequence: number; startDate: string; endDate: string }>;
}

export interface ImportContext {
  letters: Map<string, ScaleLetter>;
  /** By Student ID, trimmed. */
  students: Map<string, ContextStudent>;
  /** By `${academicYearLabel}|${sequence}`. */
  semesters: Map<string, ContextSemester>;
  courses: ContextCourse[];
  /** Non-void records already on file, by student id. */
  existing: Map<string, ExistingRecord[]>;
  /** The Academic calendar, for creating a missing past semester. */
  calendar: CalendarYear[];
  /** "Now", passed in so the analysis stays pure. */
  today: Date;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ImportCourse {
  line: number;
  code: string;
  title: string;
  letter: string;
  creditHours: number;
  /** Set when the student already has this course in an earlier semester,
   *  or it appears on an earlier sheet in this same file. */
  repeatOf: string | null;
}

/** A past semester (and, if needed, its academic year) the import will
 *  create in the Academic calendar before it imports into it. */
export interface PlannedSemester {
  /** `${yearLabel}|${sequence}` -- the same key as ImportContext.semesters. */
  key: string;
  yearLabel: string;
  /** Set when the academic year itself must be created too. */
  newYear: { startDate: string; endDate: string } | null;
  sequence: 1 | 2;
  name: string;
  startDate: string;
  endDate: string;
}

export interface ImportSheet {
  key: string;
  sourceFile: string;
  page: string;
  sheetNo: string;
  lines: string;
  /** The Student ID the sheet goes in under -- the system's, when it was
   *  settled from the file (see `idNote`). */
  studentNumber: string;
  /** The Student ID as printed on the sheet. */
  printedStudentNumber: string;
  /** Why `studentNumber` differs from the printed ID; null when it doesn't. */
  idNote: string | null;
  nameOnSheet: string;
  /** "2024/2025 — Semester II", as the sheet's header reads, whether or not
   *  the semester exists -- so a held-back sheet still says which one. */
  semesterWanted: string;
  student: { id: string; name: string } | null;
  /** `id` is null until a planned semester is created at import. */
  semester: { id: string | null; label: string; sortKey: number; create: PlannedSemester | null } | null;
  printedGpa: string;
  computedGpa: string | null;
  courses: ImportCourse[];
  problems: string[];
  status: "ready" | "blocked";
}

export interface ImportAnalysis {
  /** A problem with the file itself; when present, no sheet is analysed. */
  fileProblem: string | null;
  sheets: ImportSheet[];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Record<string, string> & { _line: string };

/** Edit distance counting a swap of two neighbouring letters as one slip
 *  ("Zoe" / "Zeo"), the commonest way a typed name goes wrong. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !NAME_SUFFIXES.has(t));
}

/**
 * Does the name printed on the sheet belong to the student the ID points
 * at? The record's first and last name must both be on the sheet. One
 * typing slip is forgiven in a name of five letters or more ("Colema" for
 * Coleman); anything further is not, because a wrong Student ID is exactly
 * what this check is here to catch.
 */
export function namesMatch(student: Pick<ContextStudent, "firstName" | "lastName">, sheetName: string): boolean {
  const tokens = nameTokens(sheetName);
  // A name part with nothing left to compare (a lone initial, blank)
  // cannot confirm anything, so it never counts as a match.
  const has = (part: string) =>
    nameTokens(part).length > 0 &&
    nameTokens(part).every((p) => tokens.some((t) => t === p || (p.length >= 5 && t.length >= 4 && editDistance(t, p) <= 1)));
  return has(student.firstName) && has(student.lastName);
}

/**
 * Could two names printed on sheets be the same person? Deliberately
 * generous -- it is only used to HOLD sheets back (the same person under
 * two Student IDs), so a false match costs a question, never a wrong
 * record. Two different words must each correspond, allowing one slip in
 * a short word and two in a word of five letters or more, in either order
 * ("Zeo Alphoso" / "Alphonso Zoe").
 */
export function mayBeSamePerson(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const close = (x: string, y: string) => x === y || editDistance(x, y) <= (Math.min(x.length, y.length) >= 5 ? 2 : 1);
  for (let i = 0; i < ta.length; i++)
    for (let j = 0; j < tb.length; j++) {
      if (!close(ta[i], tb[j])) continue;
      for (let k = 0; k < ta.length; k++)
        for (let l = 0; l < tb.length; l++) if (k !== i && l !== j && close(ta[k], tb[l])) return true;
    }
  return false;
}

function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The academic year a sheet's Year/Semester means. "2025/2026" is itself.
 * A bare year is how the older sheets were headed, and the College has
 * said "Year 2025, Semester II" is 2024/2025 Semester II -- the second
 * semester falls in the second calendar year of an academic year. A bare
 * year with Semester I is not guessed: its September could open either
 * academic year.
 */
export function academicYearFor(sheetYear: string, sequence: number): { label: string } | { problem: string } {
  const y = sheetYear.trim();
  const range = /^(\d{4})\s*\/\s*(\d{4})$/.exec(y);
  if (range) {
    if (Number(range[2]) !== Number(range[1]) + 1) return { problem: `Year "${y}" is not a valid academic year.` };
    return { label: `${range[1]}/${range[2]}` };
  }
  if (/^\d{4}$/.test(y)) {
    if (sequence === 2) return { label: `${Number(y) - 1}/${y}` };
    return {
      problem: `Year "${y}" with Semester I could be ${Number(y) - 1}/${y} or ${y}/${Number(y) + 1}. Write the academic year in full (e.g. ${y}/${Number(y) + 1}).`,
    };
  }
  return { problem: `Year "${y || "(blank)"}" is not a year.` };
}

/** "2025-02-03" moved by whole years; 29 February becomes the 28th. */
function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const year = y + years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const yearStartOf = (label: string) => Number(label.slice(0, 4));

/**
 * The dates for a past semester the calendar doesn't hold yet, copied from
 * the nearest academic year that does hold that semester, moved by whole
 * years -- the College's own calendar pattern, not a guess. A missing
 * academic year is copied the same way. Refused when no year has that
 * semester to copy, when the copy would not fit an academic year that
 * already exists, or when it would not have ended yet.
 */
export function planPastSemester(
  yearLabel: string,
  sequence: 1 | 2,
  calendar: CalendarYear[],
  today: Date,
): { plan: PlannedSemester } | { problem: string } {
  const name = `Semester ${sequence === 1 ? "I" : "II"}`;
  const full = `${yearLabel} — ${name}`;
  const target = yearStartOf(yearLabel);
  const templates = calendar
    .filter((y) => /^\d{4}\/\d{4}$/.test(y.label) && y.semesters.some((x) => x.sequence === sequence))
    .sort((a, b) => Math.abs(yearStartOf(a.label) - target) - Math.abs(yearStartOf(b.label) - target) || yearStartOf(b.label) - yearStartOf(a.label));
  const template = templates[0];
  if (!template)
    return { problem: `${full} does not exist in the Academic calendar, and no other year has a ${name} to copy its dates from. Create it in the Academic calendar first.` };

  const shift = target - yearStartOf(template.label);
  const tSem = template.semesters.find((x) => x.sequence === sequence)!;
  const startDate = shiftYears(tSem.startDate, shift);
  const endDate = shiftYears(tSem.endDate, shift);
  const existingYear = calendar.find((y) => y.label === yearLabel);
  const newYear = existingYear ? null : { startDate: shiftYears(template.startDate, shift), endDate: shiftYears(template.endDate, shift) };
  const yearStart = existingYear?.startDate ?? newYear!.startDate;
  const yearEnd = existingYear?.endDate ?? newYear!.endDate;
  if (startDate < yearStart.slice(0, 10) || endDate > yearEnd.slice(0, 10))
    return {
      problem: `${full} does not exist in the Academic calendar, and the dates copied from ${template.label} (${startDate} to ${endDate}) fall outside ${yearLabel}. Create it in the Academic calendar first.`,
    };
  if (new Date(endDate) >= today)
    return { problem: `${full} does not exist in the Academic calendar, and copied from ${template.label} it would end on ${endDate}, which has not passed yet.` };
  return { plan: { key: `${yearLabel}|${sequence}`, yearLabel, newYear, sequence, name, startDate, endDate } };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export function analyseGradeSheetCsv(text: string, ctx: ImportContext): ImportAnalysis {
  const table = parseCsv(text);
  if (table.length < 2) return { fileProblem: "The file has no data rows.", sheets: [], rowCount: 0 };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return { fileProblem: `The file is missing required columns: ${missing.join(", ")}.`, sheets: [], rowCount: 0 };
  }

  const rows: Row[] = table.slice(1).map((cells, i) => {
    const r = { _line: String(i + 2) } as Row;
    header.forEach((h, j) => (r[h] = (cells[j] ?? "").trim()));
    return r;
  });

  // Group into sheets, in file order.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.source_file}#${r.sheet_no}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const catalogueByKey = new Map(ctx.courses.map((c) => [courseCodeKey(c.code), c]));

  // Every sheet's printed ID and name, for settling a student's ID from the
  // other sheets the file has for them.
  const heads = [...groups].map(([key, rs]) => ({ key, id: rs[0].student_id, name: rs[0].student_name }));
  const fullName = (st: ContextStudent) => [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ");

  const sheets: ImportSheet[] = [];
  for (const [key, rs] of groups) {
    const h = rs[0];
    const problems: string[] = [];
    const line = (r: Row) => `Line ${r._line}`;

    // One header per sheet: every row must agree on it.
    for (const col of ["student_id", "student_name", "sheet_year", "semester_number", "sheet_gpa"] as const) {
      const values = new Set(rs.map((r) => r[col]));
      if (values.size > 1) problems.push(`The rows of this sheet disagree on ${col}: ${[...values].map((v) => `"${v}"`).join(", ")}.`);
    }

    // Student. The ID printed on the sheet, unless it is blank or not in
    // the system and the file settles it: this student's name is also on
    // other sheets, under an ID that IS in the system with this name --
    // exactly one such ID, or nothing is settled.
    const printedStudentNumber = h.student_id;
    let studentNumber = printedStudentNumber;
    let record = studentNumber ? ctx.students.get(studentNumber) : undefined;
    let idNote: string | null = null;
    let idUnsettled = false;
    if (!record && h.student_name) {
      const fileIds = new Set(
        heads.filter((o) => o.key !== key && o.id && o.id !== printedStudentNumber && mayBeSamePerson(o.name, h.student_name)).map((o) => o.id),
      );
      const inSystem = [...fileIds].filter((id) => {
        const st = ctx.students.get(id);
        return st && namesMatch(st, h.student_name);
      });
      if (inSystem.length === 1) {
        studentNumber = inSystem[0];
        record = ctx.students.get(studentNumber);
        idNote = printedStudentNumber
          ? `The sheet says ID ${printedStudentNumber}, which is not in the system. This student's other sheets use ${studentNumber}, the system's ID for ${fullName(record!)}, so it goes in under ${studentNumber}.`
          : `The sheet has no Student ID. This student's other sheets use ${studentNumber}, the system's ID for ${fullName(record!)}, so it goes in under ${studentNumber}.`;
      } else if (inSystem.length > 1) {
        idUnsettled = true;
        problems.push(`This student's sheets use IDs ${inSystem.join(" and ")}, and the system has "${h.student_name}" under each. Confirm which record is this student's.`);
      }
    }
    let student: ImportSheet["student"] = null;
    if (idUnsettled) {
      // Already explained above.
    } else if (!studentNumber) problems.push("No Student ID on this sheet, and no other sheet in the file settles it.");
    else if (!record) problems.push(`No student with ID ${studentNumber} exists in the system.`);
    else {
      const recordName = fullName(record);
      student = { id: record.id, name: recordName };
      if (!h.student_name) problems.push(`No name on this sheet to confirm ID ${studentNumber} belongs to ${recordName}.`);
      else if (!namesMatch(record, h.student_name)) {
        problems.push(`ID ${studentNumber} belongs to ${recordName}, but this sheet is for "${h.student_name}". The ID or the name is wrong.`);
        // Not this student's sheet: nothing below may treat it as theirs.
        student = null;
      } else {
        // Another record the same name also fits: the student may have been
        // enrolled twice, and these grades must land on the right one.
        const others = [...ctx.students.entries()].filter(([num, s]) => num !== studentNumber && s.id !== record.id && namesMatch(s, h.student_name));
        if (others.length)
          problems.push(
            `This name also matches ${others.map(([num, s]) => `${[s.firstName, s.lastName].join(" ")} (ID ${num})`).join(", ")} in the system. Confirm which record is this student's before importing.`,
          );
      }
    }

    // Semester: the one in the calendar, or a past one to be created.
    let semester: ImportSheet["semester"] = null;
    let semesterWanted = [h.sheet_year && `Year ${h.sheet_year}`, h.semester_number && `Semester ${h.semester_number}`].filter(Boolean).join(", ");
    const seq = Number(h.semester_number);
    if (seq !== 1 && seq !== 2) problems.push(`Semester "${h.semester_number || "(blank)"}" is not 1 or 2.`);
    else {
      const year = academicYearFor(h.sheet_year, seq);
      if ("problem" in year) problems.push(year.problem);
      else {
        const sem = ctx.semesters.get(`${year.label}|${seq}`);
        const name = `${year.label} — Semester ${seq === 1 ? "I" : "II"}`;
        semesterWanted = name;
        let startYear: number | null = null;
        if (sem) {
          semester = { id: sem.id, label: sem.label, sortKey: sem.sortKey, create: null };
          startYear = sem.startYear;
          if (!sem.hasEnded) problems.push(`${name} has not ended yet, so it cannot take past records.`);
        } else {
          const planned = planPastSemester(year.label, seq, ctx.calendar, ctx.today);
          if ("problem" in planned) problems.push(planned.problem);
          else {
            semester = { id: null, label: name, sortKey: yearStartOf(year.label) * 10 + seq, create: planned.plan };
            startYear = Number(planned.plan.startDate.slice(0, 4));
          }
        }
        if (record && startYear !== null && startYear < record.enrolmentYear)
          problems.push(`${name} is before this student's enrolment year (${record.enrolmentYear}).`);
      }
    }

    // Courses.
    const courses: ImportCourse[] = [];
    const courseRows = rs.filter((r) => r.course_title || r.course_number || r.course_code || r.grade);
    if (courseRows.length === 0) problems.push("This sheet has no courses. Nothing would be imported from it.");
    let gpaPoints = 0;
    let gpaHours = 0;
    for (const r of courseRows) {
      const label = `${line(r)} (${[r.course_title, r.course_number].filter(Boolean).join(" ") || r.course_code || "no course"})`;

      const heldFlags = (r.flags ?? "")
        .split(";")
        .map((f) => f.trim())
        .filter((f) => f && !RECHECKED_FLAGS.has(f));
      if (heldFlags.length)
        problems.push(`${label}: flagged ${heldFlags.join(", ")}${r.notes ? ` (${r.notes})` : ""}. It is held until someone has checked it against the paper sheet and cleared the flag.`);

      // Which catalogue course.
      let code: string | null = null;
      if (r.course_code) code = r.course_code;
      // A subject code is written in capitals ("ENGL"); a one-word title is
      // not ("French", "Math"), and must be matched as a title.
      else if (/^[A-Z]{2,6}$/.test(r.course_title) && r.course_number) code = `${r.course_title}${r.course_number}`;
      let course: ContextCourse | undefined;
      if (code) {
        course = catalogueByKey.get(courseCodeKey(code));
        if (!course) problems.push(`${label}: course code ${code.toUpperCase()} is not in the course catalogue.`);
      } else if (!r.course_number) {
        problems.push(`${label}: no course number.`);
      } else {
        const wanted = normTitle(r.course_title);
        const matches = ctx.courses.filter(
          (c) => normTitle(c.title) === wanted && courseCodeKey(c.code).replace(/^[a-z]+/, "") === r.course_number.toLowerCase(),
        );
        if (matches.length === 1) course = matches[0];
        else if (matches.length === 0)
          problems.push(`${label}: no course in the catalogue is numbered ${r.course_number} and titled "${r.course_title}". Add its code in a course_code column.`);
        else problems.push(`${label}: ${matches.map((m) => m.code).join(" and ")} both match "${r.course_title} ${r.course_number}". Add the right code in a course_code column.`);
      }

      // Grade.
      const letter = r.grade.toUpperCase();
      const scale = ctx.letters.get(letter);
      if (!letter) problems.push(`${label}: no grade.`);
      else if (!scale) problems.push(`${label}: "${r.grade}" is not a grade in the system.`);

      // Hours.
      const hours = Number(r.credit_hours);
      const hoursOk = r.credit_hours !== "" && Number.isFinite(hours) && hours > 0 && hours <= 12 && Number.isInteger(hours * 2);
      if (!hoursOk) problems.push(`${label}: credit hours "${r.credit_hours}" is not a valid number of hours.`);

      // Grade points must agree with the grade.
      if (scale && hoursOk) {
        const printed = r.grade_points;
        if (scale.gradePoint === null) {
          if (printed !== "" && printed !== "-" && printed !== "—")
            problems.push(`${label}: ${letter} carries no grade points, but the sheet shows ${printed}.`);
        } else {
          const expected = hours * Number(scale.gradePoint);
          const got = Number(printed);
          if (printed === "" || !Number.isFinite(got)) problems.push(`${label}: grade points "${printed}" is not a number.`);
          else if (Math.abs(expected - got) > 1e-6)
            problems.push(`${label}: ${letter} × ${fmt(hours)} hours = ${fmt(expected)} points, but the sheet shows ${printed}.`);
          if (scale.countsInGpa) {
            gpaPoints += expected;
            gpaHours += hours;
          }
        }
      }

      if (course && scale && hoursOk)
        courses.push({ line: Number(r._line), code: course.code, title: course.title, letter, creditHours: hours, repeatOf: null });
    }

    // The same course twice on one sheet.
    const seen = new Map<string, number>();
    for (const c of courses) {
      const k = courseCodeKey(c.code);
      if (seen.has(k)) problems.push(`Line ${c.line}: ${c.code} is already on this sheet (line ${seen.get(k)}). A course is taken once in a semester.`);
      else seen.set(k, c.line);
    }

    // The printed GPA must agree with the grades. A difference of 0.01 is
    // allowed, because the sheets cut off the third decimal instead of
    // rounding it.
    const computedGpa = gpaHours > 0 ? gpaPoints / gpaHours : null;
    if (computedGpa !== null) {
      const printed = Number(h.sheet_gpa);
      if (h.sheet_gpa === "" || !Number.isFinite(printed)) problems.push(`The sheet's GPA "${h.sheet_gpa}" is not a number.`);
      else if (Math.abs(printed - computedGpa) > 0.0100001)
        problems.push(`The printed GPA is ${h.sheet_gpa}, but the grades on the sheet give ${computedGpa.toFixed(2)}. A grade, hour or course is wrong.`);
    }

    sheets.push({
      key,
      sourceFile: h.source_file,
      page: h.page,
      sheetNo: h.sheet_no,
      lines: rs.length > 1 ? `${rs[0]._line}–${rs[rs.length - 1]._line}` : rs[0]._line,
      studentNumber,
      printedStudentNumber,
      idNote,
      nameOnSheet: h.student_name,
      semesterWanted,
      student,
      semester,
      printedGpa: h.sheet_gpa,
      computedGpa: computedGpa === null ? null : computedGpa.toFixed(2),
      courses,
      problems,
      status: "blocked",
    });
  }

  // One Student ID printed for two different people in the same semester:
  // neither sheet can be trusted to be that ID's, so neither goes in for
  // that semester (decided 29 Sep 2026).
  const byPrintedId = new Map<string, ImportSheet[]>();
  for (const s of sheets)
    if (s.printedStudentNumber) {
      const k = `${s.printedStudentNumber}|${s.semesterWanted}`;
      byPrintedId.set(k, [...(byPrintedId.get(k) ?? []), s]);
    }
  for (const group of byPrintedId.values()) {
    const people = group.filter((s, i) => group.findIndex((o) => mayBeSamePerson(o.nameOnSheet, s.nameOnSheet) || o.nameOnSheet === s.nameOnSheet) === i);
    if (people.length > 1)
      for (const s of group)
        s.problems.push(
          `Student ID ${s.printedStudentNumber} is printed for ${people.map((o) => `"${o.nameOnSheet}"`).join(" and ")} in ${s.semesterWanted} (${group
            .filter((o) => o !== s)
            .map((o) => `${o.sourceFile} sheet ${o.sheetNo}`)
            .join("; ")}). Neither is imported for this semester.`,
        );
  }

  // The same person landing on two different student records: a sheet was
  // matched to one record and another sheet of theirs to a different one.
  // One student has one record, so none of their sheets goes in.
  const placed = sheets.filter((s) => s.student && s.nameOnSheet);
  for (const s of placed) {
    const others = placed.filter((o) => o.student!.id !== s.student!.id && mayBeSamePerson(o.nameOnSheet, s.nameOnSheet));
    if (others.length)
      s.problems.push(
        `"${s.nameOnSheet}" (ID ${s.studentNumber}) looks like the same student as ${others
          .map((o) => `"${o.nameOnSheet}" (ID ${o.studentNumber}, ${o.sourceFile} sheet ${o.sheetNo})`)
          .join("; ")}, who is a different student in the system. Confirm which record is theirs.`,
      );
  }

  // The same student and semester on more than one sheet: which one is the
  // record is a question for the paper, so none of them goes in.
  const bySemester = new Map<string, ImportSheet[]>();
  for (const s of sheets)
    if (s.student && s.semester) {
      const k = `${s.student.id}|${s.semester.id ?? s.semester.create!.key}`;
      bySemester.set(k, [...(bySemester.get(k) ?? []), s]);
    }
  for (const group of bySemester.values())
    if (group.length > 1)
      for (const s of group)
        s.problems.push(
          `${s.student!.name}'s ${s.semester!.label} is on ${group.length} sheets (${group
            .filter((o) => o !== s)
            .map((o) => `${o.sourceFile} sheet ${o.sheetNo}`)
            .join("; ")}). Keep one.`,
        );

  // Already on record, or a repeat of an earlier attempt. Sheets are taken
  // in the order they happened, so "earlier" means earlier in time, not
  // earlier in the file.
  const ordered = [...sheets].sort((a, b) => (a.semester?.sortKey ?? 0) - (b.semester?.sortKey ?? 0));
  const takenInFile = new Map<string, Array<{ sortKey: number; label: string }>>();
  for (const s of ordered) {
    if (!s.student || !s.semester) continue;
    const onFile = ctx.existing.get(s.student.id) ?? [];
    for (const c of s.courses) {
      const k = courseCodeKey(c.code);
      const same = onFile.find((e) => e.codeKey === k && e.semesterId === s.semester!.id);
      if (same) {
        s.problems.push(`Line ${c.line}: ${c.code} is already on this student's record for ${s.semester.label} (grade ${same.letter}). This sheet may already have been imported.`);
        continue;
      }
      const earlierOnFile = onFile.find((e) => e.codeKey === k);
      const earlierInFile = (takenInFile.get(`${s.student.id}|${k}`) ?? []).find((e) => e.sortKey < s.semester!.sortKey);
      if (earlierOnFile) c.repeatOf = `already on record (grade ${earlierOnFile.letter})`;
      else if (earlierInFile) c.repeatOf = `also in ${earlierInFile.label} in this file`;
    }
    for (const c of s.courses) {
      const k = `${s.student.id}|${courseCodeKey(c.code)}`;
      takenInFile.set(k, [...(takenInFile.get(k) ?? []), { sortKey: s.semester.sortKey, label: s.semester.label }]);
    }
  }

  for (const s of sheets) s.status = s.problems.length === 0 ? "ready" : "blocked";
  return { fileProblem: null, sheets, rowCount: rows.length };
}
