import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicRecord, academicYear, semester } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { AppError, StateError, ValidationError } from "@/lib/errors";
import { courseCodeKey } from "@/lib/courses/courseCode";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { createAcademicYear } from "@/lib/academic/calendar";
import { createRetrospectiveSemester, enterHistoricalSemester } from "./historical";
import {
  analyseGradeSheetCsv,
  type ExistingRecord,
  type ImportAnalysis,
  type ImportContext,
  type ImportSheet,
  type PlannedSemester,
} from "./gradeSheetImportCore";

/**
 * Importing past grade sheets from a CSV (one row per course, one or more
 * sheets per student).
 *
 * Two calls, like the course-catalogue import. `previewGradeSheetImport`
 * reads and writes nothing: it reports, sheet by sheet, what would be
 * imported and what is held back and why. `commitGradeSheetImport` checks
 * the whole file again from scratch -- nothing from the preview is
 * trusted -- and imports only the sheets that pass, each as one
 * enterHistoricalSemester save, so a sheet is on file whole or not at all
 * and every record carries the same audit trail as one typed in by hand.
 */

// Under the 1 MB request-body limit Next.js applies to a Server Action.
const MAX_BYTES = 900_000;

async function loadContext(): Promise<ImportContext> {
  const [scaleRows, students, years, semesters, courses, records] = await Promise.all([
    db.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    db.query.student.findMany({
      columns: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true, enrolmentYear: true },
    }),
    db.query.academicYear.findMany(),
    db.query.semester.findMany(),
    db.query.course.findMany({ columns: { code: true, title: true } }),
    db.query.academicRecord.findMany({
      where: eq(academicRecord.isVoid, false),
      columns: { studentId: true, semesterId: true, courseCodeSnapshot: true, letter: true },
    }),
  ]);
  if (scaleRows.length === 0) throw new StateError("No grade scale is in effect.");

  // The same letters a record typed in by hand may use: the scale in
  // effect, older plain letters included.
  const version = Math.max(...scaleRows.map((r) => r.policyVersion));
  const letters = new Map(
    scaleRows
      .filter((r) => r.policyVersion === version)
      .map((r) => [r.letter.toUpperCase(), { gradePoint: r.gradePoint, countsInGpa: r.countsInGpa }]),
  );

  const today = new Date();
  const yearById = new Map(years.map((y) => [y.id, y]));
  const calendar = years.map((y) => ({
    label: y.label,
    startDate: String(y.startDate),
    endDate: String(y.endDate),
    semesters: semesters
      .filter((sem) => sem.academicYearId === y.id)
      .map((sem) => ({ sequence: sem.sequence, startDate: String(sem.startDate), endDate: String(sem.endDate) })),
  }));
  const semesterMap: ImportContext["semesters"] = new Map();
  for (const s of semesters) {
    const year = yearById.get(s.academicYearId);
    if (!year) continue;
    const yearStart = new Date(year.startDate).getFullYear();
    semesterMap.set(`${year.label}|${s.sequence}`, {
      id: s.id,
      label: `${year.label} — ${semesterDisplayName(s)}`,
      hasEnded: new Date(s.endDate) < today,
      startYear: new Date(s.startDate).getFullYear(),
      sortKey: yearStart * 10 + s.sequence,
    });
  }

  const existing = new Map<string, ExistingRecord[]>();
  for (const r of records) {
    const list = existing.get(r.studentId) ?? [];
    list.push({ semesterId: r.semesterId, codeKey: courseCodeKey(r.courseCodeSnapshot), letter: r.letter });
    existing.set(r.studentId, list);
  }

  return {
    letters,
    students: new Map(students.map((s) => [s.studentNumber.trim(), s])),
    semesters: semesterMap,
    // Only codes enterHistoricalSemester will find again exactly (it looks a
    // code up after upper-casing it and collapsing spaces). A catalogue code
    // stored any other way would be saved without its catalogue link, so it
    // is treated as not matchable and the row is held back instead.
    courses: courses.filter((c) => c.code === c.code.trim().toUpperCase().replace(/\s+/g, " ")),
    existing,
    calendar,
    today,
  };
}

function checkSize(text: string) {
  if (!text.trim()) throw new ValidationError("The file is empty.");
  if (text.length > MAX_BYTES) throw new ValidationError("The file is larger than 900 KB. Split it into smaller files.");
}

export async function previewGradeSheetImport(actor: Actor, text: string): Promise<ImportAnalysis> {
  await assertCan(actor, "historical.enterRecord");
  checkSize(text);
  return analyseGradeSheetCsv(text, await loadContext());
}

export interface CommitGradeSheetResult {
  imported: Array<{ sheet: string; student: string; semester: string; courses: number }>;
  /** Past semesters (and years) created in the Academic calendar for this import. */
  created: string[];
  failed: Array<{ sheet: string; reason: string }>;
  /** Ready, but waiting for the repeats on them to be confirmed. */
  heldForRepeats: string[];
  /** Ready, but waiting for their older-curriculum courses (not in the
   *  catalogue, imported as printed) to be confirmed. */
  heldForUncatalogued: string[];
  blocked: number;
}

const describe = (s: ImportSheet) => `${s.sourceFile} sheet ${s.sheetNo}`;

/** Creates a planned past semester, and its academic year when that is new
 *  too, through the same audited services the Academic calendar uses. */
export async function createPlannedSemester(actor: Actor, plan: PlannedSemester): Promise<string> {
  let year = await db.query.academicYear.findFirst({ where: eq(academicYear.label, plan.yearLabel) });
  if (!year) {
    if (!plan.newYear) throw new StateError(`Academic year ${plan.yearLabel} was expected to exist.`);
    year = await createAcademicYear(actor, { label: plan.yearLabel, ...plan.newYear });
  }
  const existing = await db.query.semester.findFirst({
    where: and(eq(semester.academicYearId, year.id), eq(semester.sequence, plan.sequence)),
  });
  if (existing) return existing.id;
  const row = await createRetrospectiveSemester(actor, {
    academicYearId: year.id,
    sequence: plan.sequence,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
  });
  return row.id;
}

export async function commitGradeSheetImport(
  actor: Actor,
  input: { text: string; fileName: string; confirmRepeats: boolean; confirmUncatalogued?: boolean },
): Promise<CommitGradeSheetResult> {
  await assertCan(actor, "historical.enterRecord");
  checkSize(input.text);

  const analysis = analyseGradeSheetCsv(input.text, await loadContext());
  if (analysis.fileProblem) throw new ValidationError(analysis.fileProblem);

  const result: CommitGradeSheetResult = {
    imported: [],
    created: [],
    failed: [],
    heldForRepeats: [],
    heldForUncatalogued: [],
    blocked: analysis.sheets.filter((s) => s.status === "blocked").length,
  };

  // In the order the semesters happened, so a course taken twice gets its
  // attempt numbers in the right order.
  const ready = analysis.sheets
    .filter((s) => s.status === "ready")
    .sort((a, b) => a.semester!.sortKey - b.semester!.sortKey);

  // A past semester the calendar doesn't hold yet is created first -- once,
  // however many sheets need it, and only for sheets that will go in.
  const createdIds = new Map<string, string>();
  const createFailed = new Map<string, string>();
  const needsConfirm = (s: ImportSheet) =>
    (s.courses.some((c) => c.repeatOf) && !input.confirmRepeats) || (s.courses.some((c) => !c.inCatalogue) && !input.confirmUncatalogued);
  const toImport = ready.filter((s) => !needsConfirm(s));
  const plans = new Map(toImport.flatMap((s) => (s.semester!.create ? [[s.semester!.create.key, s.semester!.create] as const] : [])));
  for (const plan of plans.values()) {
    try {
      createdIds.set(plan.key, await createPlannedSemester(actor, plan));
      result.created.push(
        `${plan.yearLabel} — ${plan.name} (${plan.startDate} to ${plan.endDate})${plan.newYear ? `, in the new academic year ${plan.yearLabel} (${plan.newYear.startDate} to ${plan.newYear.endDate})` : ""}`,
      );
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      createFailed.set(plan.key, err.message);
    }
  }

  for (const sheet of ready) {
    const hasRepeats = sheet.courses.some((c) => c.repeatOf);
    if (hasRepeats && !input.confirmRepeats) {
      result.heldForRepeats.push(describe(sheet));
      continue;
    }
    if (sheet.courses.some((c) => !c.inCatalogue) && !input.confirmUncatalogued) {
      result.heldForUncatalogued.push(describe(sheet));
      continue;
    }
    const plan = sheet.semester!.create;
    const semesterId = sheet.semester!.id ?? (plan ? createdIds.get(plan.key) : undefined);
    if (!semesterId) {
      result.failed.push({ sheet: describe(sheet), reason: `${sheet.semester!.label} could not be created: ${plan ? createFailed.get(plan.key) : "unknown semester"}` });
      continue;
    }
    try {
      await enterHistoricalSemester(actor, {
        studentId: sheet.student!.id,
        semesterId,
        records: sheet.courses.map((c) => ({
          courseCode: c.code,
          // An older-curriculum course keeps the title the sheet prints;
          // a catalogue course takes the catalogue's.
          courseTitleOverride: c.inCatalogue ? undefined : c.title,
          creditHours: c.creditHours,
          letter: c.letter,
          confirmAsRepeat: c.repeatOf !== null,
          sourceNote: `Grade sheet import: ${input.fileName || "CSV"} line ${c.line} (${sheet.sourceFile}, page ${sheet.page}, sheet ${sheet.sheetNo}).`,
        })),
      });
      result.imported.push({
        sheet: describe(sheet),
        student: `${sheet.student!.name} (${sheet.studentNumber})`,
        semester: sheet.semester!.label,
        courses: sheet.courses.length,
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      result.failed.push({ sheet: describe(sheet), reason: err.message });
    }
  }
  return result;
}
