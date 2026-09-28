import { randomUUID } from "node:crypto";
import { and, count, countDistinct, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicRecord, courseOffering, gradeRecord, registration, semester } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import type { SemesterSortKey } from "@/lib/gpa/engine";
import {
  buildSemesterResults,
  enteredViaLabel,
  exportFileSlug,
  yesNo,
  type CourseGradeRow,
  type ResultStudent,
  type SemesterResultRow,
  type StudentEngineRecord,
} from "./semesterExportRows";

/**
 * Section 11.3/14: "Run the semester-end export" -- a full, permissioned,
 * audited copy of one semester's academic data (REQ-B03, plan component
 * 11), in two files:
 *
 *  - COURSE GRADES: one row per student per course, straight from
 *    `academic_record`.
 *  - SEMESTER RESULTS: one row per student -- semester GPA, CGPA as at the
 *    end of that semester, credits and standing (semesterExportRows.ts).
 *
 * Both read `academic_record` only, which is by construction the College's
 * single source of academic truth (Section 9.4.14): every row in it already
 * represents a settled result -- an IMPORTED row entered by an Admin, or a
 * SYSTEM row that exists only because its source grade was PUBLISHED (the
 * DB check constraint `academic_record_origin_grade_record_coherence` plus
 * grade.ts's DEV-flow both guarantee this). There is nothing in DRAFT or
 * SUBMITTED status to filter out here -- those grades never reach this
 * table -- so "published records only" is a structural property of the
 * query, not an extra WHERE clause to get right.
 *
 * Every run -- either file, as CSV or as a printed page -- writes one
 * ACADEMIC_EXPORT_RUN audit row naming which file and format it was.
 */

export interface SemesterExportContext {
  semesterId: string;
  /** "2025/2026" */
  yearLabel: string;
  /** "Semester I" -- the display name, never the free text stored in `name`. */
  semesterName: string;
  /** "2025/2026 — Semester I" */
  label: string;
  /** "2025-2026-semester-i" */
  fileSlug: string;
  sortKey: SemesterSortKey;
}

async function loadContext(semesterId: string): Promise<SemesterExportContext> {
  const sem = await db.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");
  const year = await db.query.academicYear.findFirst({ where: (y, { eq }) => eq(y.id, sem.academicYearId) });
  if (!year) throw new ValidationError("Semester not found.");

  const semesterName = semesterDisplayName(sem);
  return {
    semesterId,
    yearLabel: year.label,
    semesterName,
    label: `${year.label} — ${semesterName}`,
    fileSlug: exportFileSlug(year.label, semesterName),
    sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 },
  };
}

/** Department and College names for a set of students, as they stand now. */
async function loadPlacement(departmentIds: string[]) {
  const departments = departmentIds.length
    ? await db.query.department.findMany({ where: (d, { inArray }) => inArray(d.id, departmentIds) })
    : [];
  const collegeIds = [...new Set(departments.map((d) => d.collegeId))];
  const colleges = collegeIds.length
    ? await db.query.college.findMany({ where: (c, { inArray }) => inArray(c.id, collegeIds) })
    : [];
  return (departmentId: string) => {
    const department = departments.find((d) => d.id === departmentId);
    return {
      department: department?.name ?? "",
      college: colleges.find((c) => c.id === department?.collegeId)?.name ?? "",
    };
  };
}

async function audit(actor: Actor, semesterId: string, file: "COURSE_GRADES" | "SEMESTER_RESULTS", format: "CSV" | "PRINT", rowCount: number) {
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "ACADEMIC_EXPORT_RUN",
      entityType: "semester",
      entityId: semesterId,
      newValue: { file, format, rowCount },
      requestId: randomUUID(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Course grades
// ---------------------------------------------------------------------------

export async function loadCourseGrades(semesterId: string): Promise<{ context: SemesterExportContext; rows: CourseGradeRow[] }> {
  const context = await loadContext(semesterId);

  const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.semesterId, semesterId) });
  const studentIds = [...new Set(records.map((r) => r.studentId))];
  const students = studentIds.length ? await db.query.student.findMany({ where: (s, { inArray }) => inArray(s.id, studentIds) }) : [];
  const studentById = new Map(students.map((s) => [s.id, s]));
  const placementOf = await loadPlacement([...new Set(students.map((s) => s.departmentId))]);

  const rows: CourseGradeRow[] = records
    .map((r) => {
      const s = studentById.get(r.studentId);
      const placement = s ? placementOf(s.departmentId) : { college: "", department: "" };
      return {
        studentNumber: s?.studentNumber ?? r.studentId,
        lastName: s?.lastName ?? "",
        firstName: s?.firstName ?? "",
        middleName: s?.middleName ?? "",
        college: placement.college,
        department: placement.department,
        academicYear: context.yearLabel,
        semester: context.semesterName,
        courseCode: r.courseCodeSnapshot,
        courseTitle: r.courseTitleSnapshot,
        creditHours: r.creditHours,
        grade: r.letter,
        gradePoint: r.gradePoint ?? "",
        attempt: String(r.attemptNo),
        enteredVia: enteredViaLabel(r.origin),
        repeatExcluded: yesNo(r.isRepeatDropped),
        void: yesNo(r.isVoid),
      };
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.studentNumber.localeCompare(b.studentNumber) ||
        a.courseCode.localeCompare(b.courseCode),
    );

  return { context, rows };
}

export async function runCourseGradesExport(actor: Actor, semesterId: string) {
  await assertCan(actor, "export.runSemesterExport");
  const result = await loadCourseGrades(semesterId);
  await audit(actor, semesterId, "COURSE_GRADES", "CSV", result.rows.length);
  return result;
}

// ---------------------------------------------------------------------------
// Semester results
// ---------------------------------------------------------------------------

export async function loadSemesterResults(semesterId: string): Promise<{ context: SemesterExportContext; rows: SemesterResultRow[] }> {
  const context = await loadContext(semesterId);

  const inSemester = await db.query.academicRecord.findMany({
    where: and(eq(academicRecord.semesterId, semesterId), eq(academicRecord.isVoid, false)),
    columns: { studentId: true },
  });
  const studentIds = [...new Set(inSemester.map((r) => r.studentId))];
  if (studentIds.length === 0) return { context, rows: [] };

  const [students, history] = await Promise.all([
    db.query.student.findMany({ where: (s, { inArray }) => inArray(s.id, studentIds) }),
    db.query.academicRecord.findMany({
      where: and(inArray(academicRecord.studentId, studentIds), eq(academicRecord.isVoid, false)),
    }),
  ]);
  const placementOf = await loadPlacement([...new Set(students.map((s) => s.departmentId))]);

  // Chronological position of every semester these students hold a record
  // in -- the same key recomputeStudentSummaries builds.
  const semesterIds = [...new Set(history.map((r) => r.semesterId))];
  const semesterRows = await db.query.semester.findMany({ where: (s, { inArray }) => inArray(s.id, semesterIds) });
  const yearIds = [...new Set(semesterRows.map((s) => s.academicYearId))];
  const yearRows = await db.query.academicYear.findMany({ where: (y, { inArray }) => inArray(y.id, yearIds) });
  const sortKeyOf = new Map<string, SemesterSortKey>();
  for (const sem of semesterRows) {
    const year = yearRows.find((y) => y.id === sem.academicYearId);
    if (year) sortKeyOf.set(sem.id, { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 });
  }

  const records: StudentEngineRecord[] = history
    .filter((r) => sortKeyOf.has(r.semesterId))
    .map((r) => ({
      id: r.id,
      studentId: r.studentId,
      courseCodeKey: r.courseCodeSnapshot.trim().toUpperCase(),
      semesterId: r.semesterId,
      semesterSortKey: sortKeyOf.get(r.semesterId)!,
      creditHours: r.creditHours,
      gradePoint: r.gradePoint,
      countsInGpa: r.countsInGpa,
      countsInAttempted: r.countsInAttempted,
      countsInEarned: r.countsInEarned,
      wasMajorAtRecord: r.wasMajorAtRecord,
      letter: r.letter,
    }));

  const resultStudents: ResultStudent[] = students.map((s) => ({
    id: s.id,
    studentNumber: s.studentNumber,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    ...placementOf(s.departmentId),
    isProvisional: s.historicalImportStatus !== "COMPLETE",
  }));

  return { context, rows: buildSemesterResults(context, resultStudents, records) };
}

export async function runSemesterResultsExport(actor: Actor, semesterId: string, format: "CSV" | "PRINT") {
  await assertCan(actor, "export.runSemesterExport");
  const result = await loadSemesterResults(semesterId);
  await audit(actor, semesterId, "SEMESTER_RESULTS", format, result.rows.length);
  return result;
}

// ---------------------------------------------------------------------------
// The export page's table
// ---------------------------------------------------------------------------

export interface ExportableSemester {
  id: string;
  label: string;
  state: string;
  /** Non-void records -- what the two files are made of. */
  recordCount: number;
  studentCount: number;
  unpublishedCount: number;
}

/** Every semester, newest first, with what an export of it would hold. */
export async function listExportableSemesters(actor: Actor): Promise<ExportableSemester[]> {
  await assertCan(actor, "export.runSemesterExport");

  const [years, semesters, counts] = await Promise.all([
    db.query.academicYear.findMany(),
    db.query.semester.findMany(),
    db
      .select({
        semesterId: academicRecord.semesterId,
        records: count(),
        students: countDistinct(academicRecord.studentId),
      })
      .from(academicRecord)
      .where(eq(academicRecord.isVoid, false))
      .groupBy(academicRecord.semesterId),
  ]);

  const yearOf = new Map(years.map((y) => [y.id, y]));
  const countOf = new Map(counts.map((c) => [c.semesterId, c]));
  const ordered = [...semesters].sort((a, b) => {
    const ya = yearOf.get(a.academicYearId)?.startDate ?? "";
    const yb = yearOf.get(b.academicYearId)?.startDate ?? "";
    return ya !== yb ? (ya < yb ? 1 : -1) : b.sequence - a.sequence;
  });

  const unpublished = await Promise.all(ordered.map((s) => countUnpublishedGrades(s.id)));

  return ordered.map((s, i) => {
    const year = yearOf.get(s.academicYearId);
    const c = countOf.get(s.id);
    return {
      id: s.id,
      label: year ? `${year.label} — ${semesterDisplayName(s)}` : semesterDisplayName(s),
      state: s.state,
      recordCount: Number(c?.records ?? 0),
      studentCount: Number(c?.students ?? 0),
      unpublishedCount: unpublished[i],
    };
  });
}

/**
 * A-20's warning clause: "Warns if any grade in scope is unpublished."
 * `academic_record` structurally never holds an unpublished grade (see the
 * note at the top of this file), so this checks the other side of the same
 * fact directly -- registered students in this semester whose grade_record
 * has not yet reached PUBLISHED/LOCKED -- so the Admin knows the export
 * they are about to download is not the semester's final word.
 */
export async function countUnpublishedGrades(semesterId: string): Promise<number> {
  const offerings = await db.query.courseOffering.findMany({ where: eq(courseOffering.semesterId, semesterId) });
  const offeringIds = offerings.map((o) => o.id);
  if (offeringIds.length === 0) return 0;

  const regs = await db.query.registration.findMany({
    where: and(inArray(registration.offeringId, offeringIds), eq(registration.status, "REGISTERED")),
  });
  const regIds = regs.map((r) => r.id);
  if (regIds.length === 0) return 0;

  const publishedGrades = await db.query.gradeRecord.findMany({
    where: and(inArray(gradeRecord.registrationId, regIds), inArray(gradeRecord.status, ["PUBLISHED", "LOCKED"])),
  });
  const publishedRegIds = new Set(publishedGrades.map((g) => g.registrationId));

  return regIds.filter((id) => !publishedRegIds.has(id)).length;
}
