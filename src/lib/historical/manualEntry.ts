import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicRecord, course, department, student } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { StateError, ValidationError } from "@/lib/errors";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { createCourse } from "@/lib/academic/structure";
import { fullName } from "@/lib/students/name";
import { enterHistoricalSemester } from "./historical";
import { createPlannedSemester } from "./gradeSheetImport";
import { planPastSemester, type CalendarYear, type PlannedSemester } from "./gradeSheetImportCore";

/**
 * One student's past semester, entered by hand from a paper grade sheet
 * (the "Enter by hand" tab of Import past grades, decided 4 Oct 2026).
 *
 * The same two calls as the CSV import. `checkManualEntry` writes nothing
 * and says, row by row, what would be saved and what stops it.
 * `saveManualEntry` checks everything again from scratch and only then
 * writes, through the same audited services the CSV import uses: a past
 * semester the calendar lacks is created the same way, a course the
 * College asked to add goes into the catalogue through createCourse, and
 * the grades go in through enterHistoricalSemester -- so a grade typed in
 * here carries exactly the checks and audit trail of an imported one.
 *
 * Grade points are never typed in: they are the grade's value times the
 * credit hours. The points printed on the paper may be entered as a check,
 * and a sheet whose own arithmetic disagrees has to be confirmed before it
 * is saved. So do credit hours that differ from the catalogue's, and a
 * repeat of a course already on the student's record.
 */

const YEAR_LABEL = /^(\d{4})\/(\d{4})$/;

export interface ManualEntryRow {
  /** As typed: "ACCT 101", "acct101" and "ACCT101" are the same course. */
  code: string;
  creditHours: number;
  letter: string;
  /** The grade points printed on the paper sheet, if entered -- a check only. */
  paperPoints?: number | null;
  /** How to record a code the catalogue does not hold. Ignored for one it does. */
  newCourse?: { mode: "catalogue"; title: string; departmentId: string } | { mode: "asPrinted"; title: string };
}

export interface ManualEntryInput {
  studentId: string;
  /** "2024/2025" */
  yearLabel: string;
  sequence: 1 | 2;
  rows: ManualEntryRow[];
  /** The semester GPA printed on the paper sheet, if entered -- a check only. */
  paperGpa?: number | null;
  /** The Admin has checked every point the check asked them to confirm. */
  confirmed?: boolean;
}

export interface ManualEntryRowCheck {
  /** "ACCT 101" */
  code: string;
  title: string;
  /** In the catalogue now, or being added to it with this save. */
  catalogue: "listed" | "adding" | "asPrinted" | "missing";
  catalogueHours: number | null;
  creditHours: number;
  letter: string;
  /** Grade value x hours; null for a grade that is not counted (NG, I, W...). */
  points: number | null;
  problems: string[];
  /** Things the Admin must confirm against the paper before saving. */
  warnings: string[];
}

export interface ManualEntryCheck {
  student: { id: string; name: string; studentNumber: string };
  semester: {
    label: string;
    /** Already in the Academic calendar. */
    exists: boolean;
    /** Set when saving will create it (and its year) first. */
    willCreate: string | null;
    /** Grades this student already has in this semester. */
    onRecord: Array<{ code: string; title: string; letter: string; creditHours: string }>;
  };
  rows: ManualEntryRowCheck[];
  totals: { hours: number; gpaHours: number; points: number; gpa: number | null };
  /** Blocking: nothing is saved while any of these stands. */
  problems: string[];
  /** Warnings across the whole entry, rows included, each to be confirmed. */
  toConfirm: string[];
}

export interface ManualEntryResult {
  saved: number;
  semester: string;
  createdSemester: string | null;
  createdCourses: string[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** The code as the catalogue stores codes: upper case, no spaces. */
function storedForm(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

interface Plan {
  check: ManualEntryCheck;
  semesterId: string | null;
  plan: PlannedSemester | null;
  /** Per row: the code to save under, and the title for a non-catalogue course. */
  save: Array<{ code: string; title: string; addToCatalogue: { title: string; departmentId: string; creditHours: number } | null }>;
}

async function analyse(actor: Actor, input: ManualEntryInput): Promise<Plan> {
  await assertCan(actor, "historical.enterRecord");

  const stu = await db.query.student.findFirst({ where: eq(student.id, input.studentId) });
  if (!stu) throw new ValidationError("Student not found.");

  const [scaleRows, years, semesters, courses, departments, records] = await Promise.all([
    db.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    db.query.academicYear.findMany(),
    db.query.semester.findMany(),
    db.query.course.findMany({ columns: { id: true, code: true, title: true, creditHours: true } }),
    db.query.department.findMany({ columns: { id: true, name: true, isActive: true } }),
    db.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, input.studentId), eq(academicRecord.isVoid, false)),
    }),
  ]);
  if (scaleRows.length === 0) throw new StateError("No grade scale is in effect.");
  const version = Math.max(...scaleRows.map((r) => r.policyVersion));
  const scale = new Map(scaleRows.filter((r) => r.policyVersion === version).map((r) => [r.letter.toUpperCase(), r]));

  const problems: string[] = [];
  const toConfirm: string[] = [];
  const today = new Date();

  // ---- The semester ------------------------------------------------------
  const yearLabel = input.yearLabel.trim();
  const sequence = input.sequence;
  const semName = `Semester ${sequence === 1 ? "I" : "II"}`;
  const label = `${yearLabel} — ${semName}`;
  const m = YEAR_LABEL.exec(yearLabel);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new ValidationError(`"${yearLabel}" is not an academic year like 2024/2025.`);
  if (sequence !== 1 && sequence !== 2) throw new ValidationError("Choose Semester I or Semester II.");

  const year = years.find((y) => y.label === yearLabel);
  const sem = year ? semesters.find((s) => s.academicYearId === year.id && s.sequence === sequence) : undefined;
  let plan: PlannedSemester | null = null;
  let semStartYear: number;
  if (sem) {
    if (new Date(sem.endDate) >= today) problems.push(`${label} has not ended yet. Past grades go only into semesters that are over.`);
    semStartYear = new Date(sem.startDate).getFullYear();
  } else {
    const calendar: CalendarYear[] = years.map((y) => ({
      label: y.label,
      startDate: String(y.startDate),
      endDate: String(y.endDate),
      semesters: semesters
        .filter((s) => s.academicYearId === y.id)
        .map((s) => ({ sequence: s.sequence, startDate: String(s.startDate), endDate: String(s.endDate) })),
    }));
    const planned = planPastSemester(yearLabel, sequence, calendar, today);
    if ("problem" in planned) {
      problems.push(planned.problem);
      semStartYear = Number(m[1]);
    } else {
      plan = planned.plan;
      semStartYear = new Date(plan.startDate).getFullYear();
    }
  }
  if (semStartYear < stu.enrolmentYear) {
    problems.push(`${label} is before ${fullName(stu)}'s enrolment year (${stu.enrolmentYear}).`);
  }

  const semesterById = new Map(semesters.map((s) => [s.id, s]));
  const yearById = new Map(years.map((y) => [y.id, y]));
  const semesterLabel = (id: string) => {
    const s = semesterById.get(id);
    const y = s ? yearById.get(s.academicYearId) : undefined;
    return s && y ? `${y.label} — ${semesterDisplayName(s)}` : "another semester";
  };
  const onRecord = sem ? records.filter((r) => r.semesterId === sem.id) : [];

  // ---- The rows ------------------------------------------------------------
  const rows = input.rows.filter((r) => r.code.trim() || r.letter.trim());
  if (rows.length === 0) problems.push("Enter at least one course.");
  if (rows.length > 20) problems.push("A semester holds at most 20 courses here.");

  const catalogue = new Map(courses.map((c) => [courseCodeKey(c.code), c]));
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const seen = new Map<string, number>();
  const checks: ManualEntryRowCheck[] = [];
  const save: Plan["save"] = [];
  let hours = 0;
  let gpaHours = 0;
  let points = 0;

  rows.forEach((r, i) => {
    const rowProblems: string[] = [];
    const rowWarnings: string[] = [];
    const key = courseCodeKey(r.code);
    const shown = formatCourseCode(storedForm(r.code)) || `Row ${i + 1}`;
    const listed = catalogue.get(key);

    if (!key) rowProblems.push("Enter a course code.");
    else if (seen.has(key)) rowProblems.push(`${shown} is entered twice (rows ${seen.get(key)! + 1} and ${i + 1}). A course is taken once in a semester.`);
    else seen.set(key, i);

    // Credit hours: the record holds one decimal place.
    const h = Number(r.creditHours);
    const hoursOk = Number.isFinite(h) && h > 0 && h <= 30 && Math.abs(h * 10 - Math.round(h * 10)) < 1e-9;
    if (!hoursOk) rowProblems.push("Credit hours must be a number above 0, like 3 or 0.5.");

    // What the course is.
    let catalogueState: ManualEntryRowCheck["catalogue"] = "listed";
    let title = listed?.title ?? "";
    let addToCatalogue: Plan["save"][number]["addToCatalogue"] = null;
    if (!listed && key) {
      const nc = r.newCourse;
      if (!nc) {
        catalogueState = "missing";
        rowProblems.push(`${shown} is not in the catalogue. Add it to the catalogue, or record it as printed.`);
      } else if (!/^[A-Za-z]+\s*\d/.test(r.code.trim())) {
        catalogueState = nc.mode === "catalogue" ? "adding" : "asPrinted";
        rowProblems.push(`"${r.code.trim()}" does not look like a course code (letters, then a number, like ACCT 101).`);
      } else if (nc.mode === "catalogue") {
        catalogueState = "adding";
        title = nc.title.trim();
        const dept = departmentById.get(nc.departmentId);
        if (!title) rowProblems.push(`Give ${shown} its title to add it to the catalogue.`);
        if (!dept || !dept.isActive) rowProblems.push(`Choose the department ${shown} belongs to.`);
        if (hoursOk && !Number.isInteger(h))
          rowProblems.push(`The catalogue holds whole credit hours only, so a ${fmt(h)}-hour course can't be added to it. Record it as printed instead.`);
        addToCatalogue = { title, departmentId: nc.departmentId, creditHours: h };
      } else {
        catalogueState = "asPrinted";
        title = nc.title.trim();
        if (!title) rowProblems.push(`Give ${shown} its title as printed on the sheet.`);
      }
    }

    if (listed && hoursOk && h !== listed.creditHours) {
      rowWarnings.push(`${shown}: ${fmt(h)} credit hours entered; the catalogue lists ${listed.creditHours}.`);
    }

    // The grade, and the points it is worth.
    const letter = r.letter.trim().toUpperCase();
    const grade = scale.get(letter);
    if (!letter) rowProblems.push("Choose a grade.");
    else if (!grade) rowProblems.push(`"${r.letter}" is not a grade in the College's grading system.`);
    const rowPoints = grade && hoursOk && grade.countsInGpa ? round2(Number(grade.gradePoint) * h) : null;
    if (hoursOk && grade) {
      hours += h;
      if (grade.countsInGpa) {
        gpaHours += h;
        points += rowPoints!;
      }
    }

    // The paper's own arithmetic, when it was entered.
    const paper = r.paperPoints;
    if (paper !== null && paper !== undefined && grade && hoursOk) {
      if (!Number.isFinite(paper) || paper < 0) rowProblems.push("Points on paper must be a number, or left blank.");
      else if (rowPoints === null && paper !== 0)
        rowWarnings.push(`${shown}: the paper shows ${fmt(paper)} points, but ${letter} is not counted in the GPA, so it is worth none.`);
      else if (rowPoints !== null && Math.abs(paper - rowPoints) > 0.001)
        rowWarnings.push(`${shown}: the paper shows ${fmt(paper)} points, but ${letter} × ${fmt(h)} hours = ${fmt(rowPoints)}. Check the grade and hours.`);
    }

    // Against the student's record.
    if (key) {
      const same = records.filter((rec) => courseCodeKey(rec.courseCodeSnapshot) === key);
      const here = sem ? same.find((rec) => rec.semesterId === sem.id) : undefined;
      if (here) rowProblems.push(`${shown} is already on record for ${label} (grade ${here.letter}).`);
      else if (same.length) {
        const prior = same.map((rec) => `${semesterLabel(rec.semesterId)}, grade ${rec.letter}`).join("; ");
        rowWarnings.push(`${shown} is already on the record (${prior}), so this is saved as a repeat.`);
      }
    }

    checks.push({
      code: shown,
      title: title || (catalogueState === "missing" ? "Not in the catalogue" : ""),
      catalogue: catalogueState,
      catalogueHours: listed?.creditHours ?? null,
      creditHours: hoursOk ? h : 0,
      letter,
      points: rowPoints,
      problems: rowProblems,
      warnings: rowWarnings,
    });
    save.push({ code: listed ? listed.code : storedForm(r.code), title: title || storedForm(r.code), addToCatalogue });
    problems.push(...rowProblems.map((p) => `Row ${i + 1}: ${p}`));
    toConfirm.push(...rowWarnings);
  });

  const gpa = gpaHours > 0 ? round2(points / gpaHours) : null;
  const paperGpa = input.paperGpa;
  if (paperGpa !== null && paperGpa !== undefined && Number.isFinite(paperGpa) && gpa !== null && Math.abs(paperGpa - gpa) > 0.001) {
    toConfirm.push(
      `The paper shows a GPA of ${paperGpa.toFixed(2)}, but these grades give ${gpa.toFixed(2)} (${fmt(round2(points))} points / ${fmt(gpaHours)} hours). The GPA is always worked out from the grades.`,
    );
  }

  return {
    check: {
      student: { id: stu.id, name: fullName(stu), studentNumber: stu.studentNumber },
      semester: {
        label,
        exists: Boolean(sem),
        willCreate: plan
          ? `${label} (${plan.startDate} to ${plan.endDate})${plan.newYear ? `, in the new academic year ${yearLabel}` : ""} will be created in the Academic calendar.`
          : null,
        onRecord: onRecord.map((rec) => ({
          code: formatCourseCode(rec.courseCodeSnapshot),
          title: rec.courseTitleSnapshot,
          letter: rec.letter,
          creditHours: String(Number(rec.creditHours)),
        })),
      },
      rows: checks,
      totals: { hours: round2(hours), gpaHours: round2(gpaHours), points: round2(points), gpa },
      problems,
      toConfirm,
    },
    semesterId: sem?.id ?? null,
    plan,
    save,
  };
}

/** Reads and writes nothing: what would be saved, and what stops it. */
export async function checkManualEntry(actor: Actor, input: ManualEntryInput): Promise<ManualEntryCheck> {
  return (await analyse(actor, input)).check;
}

/**
 * Checks everything again, then saves: the catalogue courses being added,
 * the semester if the calendar lacks it, then the grades, as one
 * enterHistoricalSemester save.
 */
export async function saveManualEntry(actor: Actor, input: ManualEntryInput): Promise<ManualEntryResult> {
  const { check, semesterId: existingId, plan, save } = await analyse(actor, input);
  if (check.problems.length) throw new ValidationError(check.problems[0]);
  if (check.toConfirm.length && !input.confirmed) {
    throw new ValidationError("Check the points listed against the paper sheet and tick the box to confirm them.");
  }

  const createdCourses: string[] = [];
  for (const s of save) {
    if (!s.addToCatalogue) continue;
    // Added now, so the grade below is linked to its catalogue course.
    // Someone may have added the same code since the check: that is fine.
    const already = await db.query.course.findFirst({ where: eq(course.code, s.code) });
    if (already) continue;
    await createCourse(actor, { departmentId: s.addToCatalogue.departmentId, code: s.code, title: s.addToCatalogue.title, creditHours: s.addToCatalogue.creditHours });
    const dept = await db.query.department.findFirst({ where: eq(department.id, s.addToCatalogue.departmentId) });
    createdCourses.push(`${formatCourseCode(s.code)} ${s.addToCatalogue.title} (${s.addToCatalogue.creditHours} hrs, ${dept?.name ?? "department"})`);
  }

  const semesterId = existingId ?? (plan ? await createPlannedSemester(actor, plan) : null);
  if (!semesterId) throw new StateError(`${check.semester.label} could not be found or created.`);

  const result = await enterHistoricalSemester(actor, {
    studentId: input.studentId,
    semesterId,
    records: input.rows
      .filter((r) => r.code.trim() || r.letter.trim())
      .map((r, i) => {
        const row = check.rows[i];
        const notes = ["Entered by hand from the paper grade sheet."];
        if (row.catalogueHours !== null && row.creditHours !== row.catalogueHours)
          notes.push(`Credit hours ${fmt(row.creditHours)} as on the sheet; the catalogue lists ${row.catalogueHours}.`);
        if (r.paperPoints !== null && r.paperPoints !== undefined && row.points !== null && Math.abs(r.paperPoints - row.points) > 0.001)
          notes.push(`The sheet printed ${fmt(r.paperPoints)} points; ${row.letter} × ${fmt(row.creditHours)} hours = ${fmt(row.points)}.`);
        if (row.catalogue === "asPrinted") notes.push("Not in the catalogue; recorded as printed.");
        return {
          courseCode: save[i].code,
          courseTitleOverride: row.catalogue === "asPrinted" ? save[i].title : undefined,
          creditHours: row.creditHours,
          letter: row.letter,
          confirmAsRepeat: true,
          sourceNote: notes.join(" "),
        };
      }),
  });

  return {
    saved: result.created.length,
    semester: check.semester.label,
    createdSemester: plan ? check.semester.willCreate : null,
    createdCourses,
  };
}
