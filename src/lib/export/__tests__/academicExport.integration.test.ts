import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicRecord,
  academicYear,
  auditLog,
  college as collegeTable,
  department as departmentTable,
  semester,
  student,
} from "@/lib/db/schema";
import { listExportableSemesters, loadCourseGrades, loadSemesterResults, runSemesterResultsExport } from "../academicExport";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The semester export against a real database: that the loaders find the
 * right records, place each student in their College and department, name
 * the semester the way every other screen does, and read CGPA as it stood
 * at the end of the exported semester rather than today.
 *
 * Direct inserts with synthetic ids, like enrolmentCounts.integration.test.ts,
 * so this runs in CI without a Supabase project.
 */

const id = () => randomUUID();
const SUPER = id(), S1 = id(), S2 = id();
const COLLEGE = id(), DEPT = id();
const YEAR_A = id(), YEAR_B = id();
const SEM_A1 = id(), SEM_A2 = id(), SEM_B1 = id();
const tag = SUPER.slice(0, 6);

const superActor = { userId: SUPER, role: "SUPER_ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;

function record(studentId: string, semesterId: string, code: string, letter: string, gradePoint: string) {
  return {
    id: id(),
    studentId,
    semesterId,
    courseCodeSnapshot: code,
    courseTitleSnapshot: `Course ${code}`,
    creditHours: "3.0",
    letter,
    gradePoint,
    origin: "IMPORTED",
    countsInGpa: true,
    countsInAttempted: true,
    countsInEarned: Number(gradePoint) >= 0.7,
    enteredBy: SUPER,
  };
}

describe("semester export", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: S1, loginIdentifier: "20198801", displayName: "One", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: S2, loginIdentifier: "20198802", displayName: "Two", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `EX-${tag}`, name: "Export College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `EXP${tag.slice(0, 3)}`, name: "Export Dept", isActive: true });
    await db.insert(student).values([
      { id: S1, studentNumber: "20198801", firstName: "Miatta", lastName: "Kollie", departmentId: DEPT, enrolmentYear: 2019, historicalImportStatus: "COMPLETE", createdBy: SUPER },
      { id: S2, studentNumber: "20198802", firstName: "Joseph", lastName: "Tarpeh", departmentId: DEPT, enrolmentYear: 2019, historicalImportStatus: "IN_PROGRESS", createdBy: SUPER },
    ]);
    await db.insert(academicYear).values([
      { id: YEAR_A, label: `EXA-${tag}`, startDate: "2019-09-01", endDate: "2020-06-30", isCurrent: false },
      { id: YEAR_B, label: `EXB-${tag}`, startDate: "2020-09-01", endDate: "2021-06-30", isCurrent: false },
    ]);
    // The stored name is free text ("First Semester"); the export must say
    // "Semester I", derived from the sequence, like every other screen.
    await db.insert(semester).values([
      { id: SEM_A1, academicYearId: YEAR_A, sequence: 1, name: "First Semester", state: "CLOSED", startDate: "2019-09-01", endDate: "2020-01-15" },
      { id: SEM_A2, academicYearId: YEAR_A, sequence: 2, name: "Second Semester", state: "CLOSED", startDate: "2020-02-01", endDate: "2020-06-30" },
      { id: SEM_B1, academicYearId: YEAR_B, sequence: 1, name: "First Semester", state: "CLOSED", startDate: "2020-09-01", endDate: "2021-01-15" },
    ]);
    await db.insert(academicRecord).values([
      record(S1, SEM_A1, "EXP101", "A", "4.00"),
      record(S1, SEM_A2, "EXP102", "B", "3.00"),
      record(S1, SEM_B1, "EXP201", "F", "0.00"), // later -- must not touch Year A's figures
      record(S2, SEM_A2, "EXP102", "C+", "2.30"),
    ]);
  });

  afterAll(async () => {
    await db.delete(auditLog).where(and(eq(auditLog.actorUserId, SUPER), eq(auditLog.action, "ACADEMIC_EXPORT_RUN"))).catch(() => {});
    await db.delete(academicRecord).where(inArray(academicRecord.studentId, [S1, S2]));
    await db.delete(semester).where(inArray(semester.id, [SEM_A1, SEM_A2, SEM_B1]));
    await db.delete(academicYear).where(inArray(academicYear.id, [YEAR_A, YEAR_B]));
    await db.delete(student).where(inArray(student.id, [S1, S2]));
    await db.delete(departmentTable).where(eq(departmentTable.id, DEPT));
    await db.delete(collegeTable).where(eq(collegeTable.id, COLLEGE));
    await db.delete(appUser).where(inArray(appUser.id, [S1, S2]));
  });

  it("course grades carry the year, Semester I/II, College and department", async () => {
    const { context, rows } = await loadCourseGrades(SEM_A2);
    expect(context.semesterName).toBe("Semester II");
    expect(context.fileSlug).toBe(`exa-${tag}-semester-ii`.toLowerCase());
    expect(rows.map((r) => r.studentNumber)).toEqual(["20198801", "20198802"]);
    expect(rows[0]).toMatchObject({
      academicYear: `EXA-${tag}`,
      semester: "Semester II",
      college: "Export College",
      department: "Export Dept",
      grade: "B",
      enteredVia: "Historical entry",
      void: "No",
    });
  });

  it("semester results read CGPA as at the end of that semester", async () => {
    const { rows } = await loadSemesterResults(SEM_A2);
    const kollie = rows.find((r) => r.studentNumber === "20198801")!;
    // A and B only: (4 + 3) / 2. The later F is in a semester not yet taken.
    expect(kollie).toMatchObject({ semesterGpa: "3.000", cgpa: "3.500", standing: "Honours", cumulativeCreditsEarned: "6.0" });

    const tarpeh = rows.find((r) => r.studentNumber === "20198802")!;
    expect(tarpeh.standing).toBe("Provisional");
  });

  it("the page lists each semester with what it holds", async () => {
    const list = await listExportableSemesters(superActor);
    const a2 = list.find((s) => s.id === SEM_A2)!;
    expect(a2).toMatchObject({ recordCount: 2, studentCount: 2, unpublishedCount: 0 });
    expect(a2.label).toBe(`EXA-${tag} — Semester II`);
    // Newest first.
    expect(list.findIndex((s) => s.id === SEM_B1)).toBeLessThan(list.findIndex((s) => s.id === SEM_A2));
  });

  it("every run is audited with the file and format", async () => {
    await runSemesterResultsExport(superActor, SEM_A2, "PRINT");
    const rows = await db.query.auditLog.findMany({
      where: and(eq(auditLog.actorUserId, SUPER), eq(auditLog.action, "ACADEMIC_EXPORT_RUN"), eq(auditLog.entityId, SEM_A2)),
    });
    expect(rows.map((r) => r.newValue)).toContainEqual({ file: "SEMESTER_RESULTS", format: "PRINT", rowCount: 2 });
  });
});
