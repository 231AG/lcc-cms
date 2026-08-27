import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { academicRecord, student, studentCumulativeSummary, studentSemesterSummary } from "@/lib/db/schema";
import {
  DEFAULT_GPA_POLICY,
  computeCumulativeSummary,
  computeSemesterSummary,
  resolveRepeats,
  type EngineRecord,
  type SemesterSortKey,
} from "./engine";

/**
 * The recomputation service (Section 16.8's trigger table; Section 9.4.15).
 * Participates in the CALLER's transaction -- takes `tx`, never starts its
 * own -- so a grade publication, correction, void, historical entry, or
 * import-status change all recompute in the same atomic unit as the
 * write that made them stale. There is no background job (Section 7.4);
 * recompute-on-write inside the triggering transaction is the only
 * mechanism this system has, by design.
 */

async function getActivePolicyVersion(tx: Tx): Promise<number> {
  const rows = await tx.query.gradeScale.findMany({
    where: (g, { lte }) => lte(g.effectiveFrom, new Date()),
  });
  if (rows.length === 0) throw new Error("No grade scale is in effect.");
  return Math.max(...rows.map((r) => r.policyVersion));
}

/**
 * Recomputes both summary tables for one student from scratch, from
 * `academic_record` -- the tables "may be deleted and rebuilt... at any
 * time without loss; that is the test of whether it is really a cache"
 * (9.4.15). Also rewrites `is_repeat_dropped` on every affected record,
 * since repeat resolution is "computed, never stored by hand" (Section
 * 16.5) -- the stored flag is a read-optimisation for display (the "R"
 * marker), never trusted as an input to this function.
 */
export async function recomputeStudentSummaries(tx: Tx, studentId: string): Promise<void> {
  const studentRow = await tx.query.student.findFirst({ where: eq(student.id, studentId) });
  if (!studentRow) throw new Error(`Cannot recompute summaries: student ${studentId} not found.`);

  const records = await tx.query.academicRecord.findMany({
    where: and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false)),
  });

  const semesterIds = [...new Set(records.map((r) => r.semesterId))];
  const semesterRows = semesterIds.length
    ? await tx.query.semester.findMany({ where: (s, { inArray }) => inArray(s.id, semesterIds) })
    : [];
  const academicYearIds = [...new Set(semesterRows.map((s) => s.academicYearId))];
  const yearRows = academicYearIds.length
    ? await tx.query.academicYear.findMany({ where: (y, { inArray }) => inArray(y.id, academicYearIds) })
    : [];

  const sortKeyBySemesterId = new Map<string, SemesterSortKey>();
  for (const sem of semesterRows) {
    const year = yearRows.find((y) => y.id === sem.academicYearId);
    if (!year) continue;
    sortKeyBySemesterId.set(sem.id, {
      yearStart: new Date(year.startDate).getFullYear(),
      sequence: sem.sequence as 1 | 2,
    });
  }

  const engineRecords: EngineRecord[] = records
    .filter((r) => sortKeyBySemesterId.has(r.semesterId))
    .map((r) => ({
      id: r.id,
      courseCodeKey: r.courseCodeSnapshot.trim().toUpperCase(),
      semesterId: r.semesterId,
      semesterSortKey: sortKeyBySemesterId.get(r.semesterId)!,
      creditHours: r.creditHours,
      gradePoint: r.gradePoint,
      countsInGpa: r.countsInGpa,
      countsInAttempted: r.countsInAttempted,
      countsInEarned: r.countsInEarned,
      wasMajorAtRecord: r.wasMajorAtRecord,
      letter: r.letter,
    }));

  const isRepeatDropped = resolveRepeats(engineRecords);
  const policyVersion = await getActivePolicyVersion(tx);
  const isProvisional = studentRow.historicalImportStatus !== "COMPLETE";

  // Rewrite the display-only "R" flag to match what was just computed.
  for (const r of engineRecords) {
    const dropped = isRepeatDropped.get(r.id) ?? false;
    await tx.update(academicRecord).set({ isRepeatDropped: dropped }).where(eq(academicRecord.id, r.id));
  }

  // One summary row per semester the student has any record in.
  for (const semId of new Set(engineRecords.map((r) => r.semesterId))) {
    const semesterRecords = engineRecords.filter((r) => r.semesterId === semId);
    const result = computeSemesterSummary(semesterRecords);
    await tx
      .insert(studentSemesterSummary)
      .values({
        studentId,
        semesterId: semId,
        gpa: result.gpa,
        creditsAttempted: result.creditsAttempted,
        creditsEarned: result.creditsEarned,
        isProvisional,
        policyVersion,
      })
      .onConflictDoUpdate({
        target: [studentSemesterSummary.studentId, studentSemesterSummary.semesterId],
        set: {
          gpa: result.gpa,
          creditsAttempted: result.creditsAttempted,
          creditsEarned: result.creditsEarned,
          isProvisional,
          policyVersion,
          computedAt: new Date(),
        },
      });
  }

  const cumulative = computeCumulativeSummary(engineRecords, isRepeatDropped);
  await tx
    .insert(studentCumulativeSummary)
    .values({
      studentId,
      cgpa: cumulative.cgpa,
      totalCreditsAttempted: cumulative.totalCreditsAttempted,
      totalCreditsEarned: cumulative.totalCreditsEarned,
      isProvisional,
      policyVersion,
    })
    .onConflictDoUpdate({
      target: studentCumulativeSummary.studentId,
      set: {
        cgpa: cumulative.cgpa,
        totalCreditsAttempted: cumulative.totalCreditsAttempted,
        totalCreditsEarned: cumulative.totalCreditsEarned,
        isProvisional,
        policyVersion,
        computedAt: new Date(),
      },
    });
}

export { DEFAULT_GPA_POLICY };
