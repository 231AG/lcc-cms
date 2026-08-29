import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { academicRecord, gradeRecord, studentCumulativeSummary, studentSemesterSummary } from "@/lib/db/schema";
import { recomputeStudentSummaries } from "./recompute";

/**
 * The reconciliation queries of Section 22.4, "run before every go-live
 * and at every semester end." All three are implemented here: I-15 and
 * I-16 date from Stage 7; I-05 ("published grades have records") needed
 * Stage 10's grade_record table, which now exists.
 */

export interface ReconciliationMismatch {
  studentId: string;
  field: string;
  stored: string | null;
  recomputed: string | null;
}

/**
 * Invariant I-15: student_semester_summary/student_cumulative_summary
 * equal the GPA engine's output for that student. Reuses the real
 * recomputation path (rather than a second, divergent implementation of
 * the same math) to rebuild every summary and reports what changed. This
 * WRITES the recomputed values -- self-healing any drift found, which is
 * the point of running it before a semester close -- so a caller that
 * wants a strictly read-only check (e.g. an audit that must not mutate
 * anything) should invoke this inside a transaction it rolls back
 * afterward rather than committing.
 */
export async function reconcileSummariesMatchEngine(tx: Tx, studentIds: string[]): Promise<ReconciliationMismatch[]> {
  const mismatches: ReconciliationMismatch[] = [];

  for (const studentId of studentIds) {
    const before = await tx.query.studentCumulativeSummary.findFirst({
      where: eq(studentCumulativeSummary.studentId, studentId),
    });
    const beforeSemesters = await tx.query.studentSemesterSummary.findMany({
      where: eq(studentSemesterSummary.studentId, studentId),
    });

    await recomputeStudentSummaries(tx, studentId);

    const after = await tx.query.studentCumulativeSummary.findFirst({
      where: eq(studentCumulativeSummary.studentId, studentId),
    });
    if (before?.cgpa !== after?.cgpa) {
      mismatches.push({ studentId, field: "cgpa", stored: before?.cgpa ?? null, recomputed: after?.cgpa ?? null });
    }

    const afterSemesters = await tx.query.studentSemesterSummary.findMany({
      where: eq(studentSemesterSummary.studentId, studentId),
    });
    for (const afterRow of afterSemesters) {
      const beforeRow = beforeSemesters.find((s) => s.semesterId === afterRow.semesterId);
      if (beforeRow?.gpa !== afterRow.gpa) {
        mismatches.push({
          studentId,
          field: `semester:${afterRow.semesterId}:gpa`,
          stored: beforeRow?.gpa ?? null,
          recomputed: afterRow.gpa,
        });
      }
    }
  }

  return mismatches;
}

export interface RepeatCoherenceIssue {
  studentId: string;
  courseCodeKey: string;
  keptCount: number;
}

/**
 * Invariant I-16: for each (student, course) group with more than one
 * GPA-eligible, non-void record, exactly one has is_repeat_dropped =
 * false. Zero rows expected.
 */
export async function reconcileRepeatResolutionCoherence(tx: Tx, studentIds: string[]): Promise<RepeatCoherenceIssue[]> {
  const issues: RepeatCoherenceIssue[] = [];

  for (const studentId of studentIds) {
    const records = await tx.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false)),
    });
    const groups = new Map<string, typeof records>();
    for (const r of records) {
      if (!r.countsInGpa) continue;
      const key = r.courseCodeSnapshot.trim().toUpperCase();
      const group = groups.get(key);
      if (group) group.push(r);
      else groups.set(key, [r]);
    }
    for (const [courseCodeKey, group] of groups) {
      if (group.length < 2) continue;
      const keptCount = group.filter((r) => !r.isRepeatDropped).length;
      if (keptCount !== 1) issues.push({ studentId, courseCodeKey, keptCount });
    }
  }

  return issues;
}

export interface PublishedGradeRecordMismatch {
  kind: "PUBLISHED_GRADE_WITHOUT_RECORD" | "SYSTEM_RECORD_NOT_PUBLISHED";
  gradeRecordId: string;
  academicRecordId: string | null;
}

/**
 * Invariant I-05: every PUBLISHED/LOCKED grade_record has exactly one
 * academic_record pointing back at it (origin SYSTEM), and every SYSTEM
 * academic_record's source grade is still PUBLISHED or LOCKED. Read-only
 * -- unlike the other two checks, there is nothing to self-heal here; a
 * mismatch means the publish transaction was interrupted or a defect
 * exists, and needs investigation, not an automatic fix.
 */
export async function reconcilePublishedGradesHaveRecords(tx: Tx): Promise<PublishedGradeRecordMismatch[]> {
  const mismatches: PublishedGradeRecordMismatch[] = [];

  const published = await tx.query.gradeRecord.findMany({
    where: inArray(gradeRecord.status, ["PUBLISHED", "LOCKED"]),
  });
  const publishedIds = published.map((g) => g.id);
  const systemRecords = publishedIds.length
    ? await tx.query.academicRecord.findMany({ where: and(eq(academicRecord.origin, "SYSTEM"), inArray(academicRecord.gradeRecordId, publishedIds)) })
    : [];
  const recordByGradeId = new Map(systemRecords.map((r) => [r.gradeRecordId, r]));

  for (const g of published) {
    if (!recordByGradeId.has(g.id)) {
      mismatches.push({ kind: "PUBLISHED_GRADE_WITHOUT_RECORD", gradeRecordId: g.id, academicRecordId: null });
    }
  }

  const allSystemRecords = await tx.query.academicRecord.findMany({ where: eq(academicRecord.origin, "SYSTEM") });
  const publishedIdSet = new Set(publishedIds);
  for (const r of allSystemRecords) {
    if (r.gradeRecordId && !publishedIdSet.has(r.gradeRecordId)) {
      mismatches.push({ kind: "SYSTEM_RECORD_NOT_PUBLISHED", gradeRecordId: r.gradeRecordId, academicRecordId: r.id });
    }
  }

  return mismatches;
}
