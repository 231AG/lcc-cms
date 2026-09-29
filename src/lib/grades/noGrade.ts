import { and, eq } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { academicRecord } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";
import { ForbiddenError } from "@/lib/errors";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { listName } from "@/lib/students/name";
import type { SemesterSortKey } from "@/lib/gpa/engine";
import { computeNoGradeDeadlineSemester, formatSemesterLabel } from "@/lib/gpa/incompleteDeadline";

/**
 * NG, No Grade (decided 29 Sep 2026): not counted, and settled within the
 * two semesters after the one it was given in. An NG still standing once
 * that deadline semester has ended is recorded as F -- by an Admin, on the
 * student's past-record page, with a reason, like any other correction.
 * This system has no background job, so nothing turns an NG into an F on
 * its own; this list is how the office sees which are due and which are
 * overdue.
 */

export interface CalendarSemester {
  sortKey: SemesterSortKey;
  endDate: string;
}

export type NoGradeStatus =
  | { overdue: true; deadline: SemesterSortKey }
  | { overdue: false; deadline: SemesterSortKey; deadlineInCalendar: boolean };

/**
 * Overdue only once the deadline semester is in the calendar and has
 * ended. A deadline semester the calendar doesn't hold yet cannot have
 * ended, so the NG is still within its time.
 */
export function noGradeStatus(awardedIn: SemesterSortKey, calendar: CalendarSemester[], now: Date): NoGradeStatus {
  const deadline = computeNoGradeDeadlineSemester(awardedIn);
  const row = calendar.find((s) => s.sortKey.yearStart === deadline.yearStart && s.sortKey.sequence === deadline.sequence);
  if (row && new Date(row.endDate) < now) return { overdue: true, deadline };
  return { overdue: false, deadline, deadlineInCalendar: Boolean(row) };
}

export interface NoGradeRow {
  recordId: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  courseCode: string;
  courseTitle: string;
  creditHours: string;
  semesterLabel: string;
  /** "2026/2027 — Semester I" */
  settleBy: string;
  overdue: boolean;
  /** Imported past records are corrected on the student's past-record page. */
  isImported: boolean;
}

/** Every NG on file, overdue first, then by the semester it was given in. */
export async function listNoGradeRecords(actor: Actor): Promise<NoGradeRow[]> {
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError("Not available to your role.");
  const now = new Date();

  return asUser(actor.userId, async (tx) => {
    const records = await tx.query.academicRecord.findMany({
      where: and(eq(academicRecord.letter, "NG"), eq(academicRecord.isVoid, false)),
    });
    if (records.length === 0) return [];

    const [students, semesters, years] = await Promise.all([
      tx.query.student.findMany({ columns: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } }),
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const yearById = new Map(years.map((y) => [y.id, y]));
    const calendar = semesters.flatMap((s) => {
      const year = yearById.get(s.academicYearId);
      if (!year || (s.sequence !== 1 && s.sequence !== 2)) return [];
      return [{ id: s.id, semester: s, year, sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: s.sequence as 1 | 2 }, endDate: String(s.endDate) }];
    });
    const bySemesterId = new Map(calendar.map((c) => [c.id, c]));

    const rows = records.flatMap((r) => {
      const sem = bySemesterId.get(r.semesterId);
      const stu = studentById.get(r.studentId);
      if (!sem || !stu) return [];
      const status = noGradeStatus(sem.sortKey, calendar, now);
      return [
        {
          row: {
            recordId: r.id,
            studentId: r.studentId,
            studentNumber: stu.studentNumber,
            studentName: listName(stu),
            courseCode: r.courseCodeSnapshot,
            courseTitle: r.courseTitleSnapshot,
            creditHours: r.creditHours,
            semesterLabel: semesterFullLabel(sem.year, sem.semester),
            settleBy: formatSemesterLabel(status.deadline),
            overdue: status.overdue,
            isImported: r.origin === "IMPORTED",
          } satisfies NoGradeRow,
          order: sem.sortKey.yearStart * 10 + sem.sortKey.sequence,
        },
      ];
    });
    rows.sort((a, b) => Number(b.row.overdue) - Number(a.row.overdue) || a.order - b.order || a.row.studentName.localeCompare(b.row.studentName));
    return rows.map((x) => x.row);
  });
}
