import { and, eq, inArray } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { academicRecord, studentCumulativeSummary, studentSemesterSummary } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";
import { levelForCredits, type StudentLevel } from "@/lib/students/level";
import { DEFAULT_GPA_POLICY, MAJOR_REPEAT_LETTERS, creditsToGraduation, deriveAcademicStanding, formatGpa, type AcademicStanding } from "./engine";

/**
 * Read-side of the GPA engine (S-04/S-05, A-10 -- Section 20). RLS-scoped
 * via asUser(), not assertCan-gated -- a student's own figures are theirs
 * to see, Admin/Super Admin see any student's, same pattern as every
 * other read in this codebase (Section 18.4).
 */

export interface SemesterSummaryView {
  semesterId: string;
  gpa: string | null; // 3dp display value, or null
  creditsAttempted: string;
  creditsEarned: string;
  isProvisional: boolean;
}

export async function getSemesterSummaries(actor: Actor, studentId: string): Promise<SemesterSummaryView[]> {
  const rows = await asUser(actor.userId, (tx) =>
    tx.query.studentSemesterSummary.findMany({ where: eq(studentSemesterSummary.studentId, studentId) }),
  );
  return rows.map((r) => ({
    semesterId: r.semesterId,
    gpa: formatGpa(r.gpa),
    creditsAttempted: r.creditsAttempted,
    creditsEarned: r.creditsEarned,
    isProvisional: r.isProvisional,
  }));
}

export interface CumulativeSummaryView {
  /** What the degree requires, so a screen can show progress against it
   *  without importing the policy itself. */
  graduationCreditHours: number;
  cgpa: string | null; // 3dp display value, or null
  totalCreditsAttempted: string;
  totalCreditsEarned: string;
  creditsToGraduation: string;
  isProvisional: boolean;
  standing: AcademicStanding;
}

export async function getCumulativeSummary(actor: Actor, studentId: string): Promise<CumulativeSummaryView | null> {
  const row = await asUser(actor.userId, (tx) =>
    tx.query.studentCumulativeSummary.findFirst({ where: eq(studentCumulativeSummary.studentId, studentId) }),
  );
  if (!row) return null;

  const cgpa = formatGpa(row.cgpa);
  return {
    cgpa,
    totalCreditsAttempted: row.totalCreditsAttempted,
    totalCreditsEarned: row.totalCreditsEarned,
    creditsToGraduation: creditsToGraduation(row.totalCreditsEarned, DEFAULT_GPA_POLICY),
    graduationCreditHours: DEFAULT_GPA_POLICY.graduationCreditHours,
    isProvisional: row.isProvisional,
    standing: deriveAcademicStanding(cgpa, row.isProvisional, DEFAULT_GPA_POLICY),
  };
}

export interface RepeatObligationView {
  recordId: string;
  courseCode: string;
  courseTitle: string;
  letter: string;
  reason: "F" | "D_MAJOR";
}

/**
 * Evaluated over the kept (non-repeat-dropped, non-void) attempt of each
 * course only (Section 16.4.2/16.5) -- an advisory obligation, surfaced
 * here for A-10/S-05 to display; it blocks nothing by itself (Section
 * 16.4.2: "does not silently block a student").
 */
export async function getOutstandingRepeatObligations(actor: Actor, studentId: string): Promise<RepeatObligationView[]> {
  const rows = await asUser(actor.userId, (tx) =>
    tx.query.academicRecord.findMany({
      where: and(
        eq(academicRecord.studentId, studentId),
        eq(academicRecord.isVoid, false),
        eq(academicRecord.isRepeatDropped, false),
      ),
    }),
  );

  const obligations: RepeatObligationView[] = [];
  for (const r of rows) {
    if (r.letter === "F") {
      obligations.push({ recordId: r.id, courseCode: r.courseCodeSnapshot, courseTitle: r.courseTitleSnapshot, letter: r.letter, reason: "F" });
    } else if (MAJOR_REPEAT_LETTERS.has(r.letter) && r.wasMajorAtRecord) {
      obligations.push({ recordId: r.id, courseCode: r.courseCodeSnapshot, courseTitle: r.courseTitleSnapshot, letter: r.letter, reason: "D_MAJOR" });
    }
  }
  return obligations;
}

/**
 * Each student's level (Freshman ... Senior), from the credit hours the
 * engine has them as having earned. One query for a whole page of
 * students; a student with no summary yet has earned nothing, so is a
 * Freshman. RLS-scoped like every other read here.
 */
export async function getStudentLevels(actor: Actor, studentIds: string[]): Promise<Map<string, StudentLevel>> {
  const rows = studentIds.length
    ? await asUser(actor.userId, (tx) =>
        tx
          .select({ studentId: studentCumulativeSummary.studentId, earned: studentCumulativeSummary.totalCreditsEarned })
          .from(studentCumulativeSummary)
          .where(inArray(studentCumulativeSummary.studentId, studentIds)),
      )
    : [];
  const earned = new Map(rows.map((r) => [r.studentId, r.earned]));
  return new Map(studentIds.map((id) => [id, levelForCredits(earned.get(id))]));
}
