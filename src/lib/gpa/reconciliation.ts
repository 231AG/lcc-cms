import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { academicRecord, studentCumulativeSummary, studentSemesterSummary } from "@/lib/db/schema";
import { recomputeStudentSummaries } from "./recompute";

/**
 * The reconciliation queries of Section 22.4, "run before every go-live
 * and at every semester end." Two of the three apply to Stage 7's own
 * data (I-15, I-16); the third ("published grades have records") checks
 * grade_record, which doesn't exist until Stage 10 -- there is nothing to
 * reconcile against yet, so it's omitted here rather than faked.
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
