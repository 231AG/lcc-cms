import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicRecord } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { AppError, StateError, ValidationError } from "@/lib/errors";
import { courseCodeKey } from "@/lib/courses/courseCode";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { enterHistoricalSemester } from "./historical";
import {
  analyseGradeSheetCsv,
  type ExistingRecord,
  type ImportAnalysis,
  type ImportContext,
  type ImportSheet,
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
  failed: Array<{ sheet: string; reason: string }>;
  /** Ready, but waiting for the repeats on them to be confirmed. */
  heldForRepeats: string[];
  blocked: number;
}

const describe = (s: ImportSheet) => `${s.sourceFile} sheet ${s.sheetNo}`;

export async function commitGradeSheetImport(
  actor: Actor,
  input: { text: string; fileName: string; confirmRepeats: boolean },
): Promise<CommitGradeSheetResult> {
  await assertCan(actor, "historical.enterRecord");
  checkSize(input.text);

  const analysis = analyseGradeSheetCsv(input.text, await loadContext());
  if (analysis.fileProblem) throw new ValidationError(analysis.fileProblem);

  const result: CommitGradeSheetResult = {
    imported: [],
    failed: [],
    heldForRepeats: [],
    blocked: analysis.sheets.filter((s) => s.status === "blocked").length,
  };

  // In the order the semesters happened, so a course taken twice gets its
  // attempt numbers in the right order.
  const ready = analysis.sheets
    .filter((s) => s.status === "ready")
    .sort((a, b) => a.semester!.sortKey - b.semester!.sortKey);

  for (const sheet of ready) {
    const hasRepeats = sheet.courses.some((c) => c.repeatOf);
    if (hasRepeats && !input.confirmRepeats) {
      result.heldForRepeats.push(describe(sheet));
      continue;
    }
    try {
      await enterHistoricalSemester(actor, {
        studentId: sheet.student!.id,
        semesterId: sheet.semester!.id,
        records: sheet.courses.map((c) => ({
          courseCode: c.code,
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
