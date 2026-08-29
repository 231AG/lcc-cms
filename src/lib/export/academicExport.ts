import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicRecord, courseOffering, gradeRecord, registration, semester } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";

export interface ExportRow {
  studentNumber: string;
  studentLastName: string;
  studentFirstName: string;
  semesterLabel: string;
  courseCode: string;
  courseTitle: string;
  creditHours: string;
  letter: string;
  gradePoint: string | null;
  attemptNo: number;
  origin: string;
  isRepeatDropped: boolean;
  isVoid: boolean;
}

/**
 * Section 11.3/14: "Run the semester-end export" -- a full, permissioned,
 * audited copy of one semester's academic data (REQ-B03, plan component
 * 11). Reads `academic_record` only, which is by construction the
 * College's single source of academic truth (Section 9.4.14): every row
 * in it already represents a settled result -- an IMPORTED row entered by
 * an Admin, or a SYSTEM row that exists only because its source grade was
 * PUBLISHED (the DB check constraint `academic_record_origin_grade_record_
 * coherence` plus grade.ts's DEV-flow both guarantee this). There is
 * nothing in DRAFT or SUBMITTED status to filter out here -- those grades
 * never reach this table -- so "published records only" is a structural
 * property of the query, not an extra WHERE clause to get right.
 */
export async function runSemesterExport(actor: Actor, semesterId: string): Promise<{ semesterLabel: string; rows: ExportRow[] }> {
  await assertCan(actor, "export.runSemesterExport");

  const sem = await db.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");

  const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.semesterId, semesterId) });
  const studentIds = [...new Set(records.map((r) => r.studentId))];
  const students = studentIds.length ? await db.query.student.findMany({ where: (s, { inArray }) => inArray(s.id, studentIds) }) : [];
  const studentById = new Map(students.map((s) => [s.id, s]));

  const rows: ExportRow[] = records
    .map((r) => {
      const s = studentById.get(r.studentId);
      return {
        studentNumber: s?.studentNumber ?? r.studentId,
        studentLastName: s?.lastName ?? "",
        studentFirstName: s?.firstName ?? "",
        semesterLabel: sem.name,
        courseCode: r.courseCodeSnapshot,
        courseTitle: r.courseTitleSnapshot,
        creditHours: r.creditHours,
        letter: r.letter,
        gradePoint: r.gradePoint,
        attemptNo: r.attemptNo,
        origin: r.origin,
        isRepeatDropped: r.isRepeatDropped,
        isVoid: r.isVoid,
      };
    })
    .sort((a, b) => a.studentLastName.localeCompare(b.studentLastName) || a.courseCode.localeCompare(b.courseCode));

  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "ACADEMIC_EXPORT_RUN",
      entityType: "semester",
      entityId: semesterId,
      newValue: { rowCount: rows.length },
      requestId: randomUUID(),
    }),
  );

  return { semesterLabel: sem.name, rows };
}

/**
 * A-20's warning clause: "Warns if any grade in scope is unpublished."
 * `academic_record` structurally never holds an unpublished grade (see
 * runSemesterExport's own doc comment), so this checks the other side of
 * the same fact directly -- registered students in this semester whose
 * grade_record has not yet reached PUBLISHED/LOCKED -- so the Admin knows
 * the export they are about to download is not the semester's final word.
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

const CSV_COLUMNS: Array<{ key: keyof ExportRow; header: string }> = [
  { key: "studentNumber", header: "Student ID" },
  { key: "studentLastName", header: "Last Name" },
  { key: "studentFirstName", header: "First Name" },
  { key: "semesterLabel", header: "Semester" },
  { key: "courseCode", header: "Course Code" },
  { key: "courseTitle", header: "Course Title" },
  { key: "creditHours", header: "Credit Hours" },
  { key: "letter", header: "Grade" },
  { key: "gradePoint", header: "Grade Point" },
  { key: "attemptNo", header: "Attempt #" },
  { key: "origin", header: "Origin" },
  { key: "isRepeatDropped", header: "Excluded (Repeat)" },
  { key: "isVoid", header: "Void" },
];

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Openable without the system (Section 11.3's own wording) -- plain CSV, no proprietary format. */
export function toCsv(rows: ExportRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
