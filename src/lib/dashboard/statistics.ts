import { sql } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { college, department, student } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The high-level figures behind the dashboard charts.
 *
 * Three GROUP BY queries, not a fetch-everything-and-count-in-JS: the
 * dashboard is the first screen an Admin sees, and the point of a summary
 * is that it costs less than the thing it summarises. Each returns tens of
 * rows at most, whatever the enrolment.
 *
 * RLS-scoped through asUser() like every other read here, so a Student
 * reaching this would see only their own row -- but no Student screen calls
 * it, and the dashboard checks the role before rendering either way.
 */

/** The stored value as it should read on a chart. */
const GENDER_CHART_LABEL: Record<string, string> = {
  FEMALE: "Female",
  MALE: "Male",
  NOT_RECORDED: "Not recorded",
};
const GENDER_ORDER = ["Female", "Male", "Not recorded"];

export interface CountByLabel {
  label: string;
  count: number;
}

export interface StudentStatistics {
  total: number;
  byStatus: CountByLabel[];
  byCollege: CountByLabel[];
  byEnrolmentYear: CountByLabel[];
  /** Includes a "Not recorded" row for students enrolled before the field
   *  existed -- the honest shape of this data for some time yet. */
  byGender: CountByLabel[];
}

export async function getStudentStatistics(actor: Actor): Promise<StudentStatistics> {
  return asUser(actor.userId, async (tx) => {
    const [statusRows, collegeRows, yearRows, genderRows] = await Promise.all([
      tx
        .select({ label: student.status, count: sql<number>`count(*)::int` })
        .from(student)
        .groupBy(student.status),
      tx
        .select({ label: sql<string>`${college.code} || ' — ' || ${college.name}`, count: sql<number>`count(*)::int` })
        .from(student)
        .innerJoin(department, sql`${department.id} = ${student.departmentId}`)
        .innerJoin(college, sql`${college.id} = ${department.collegeId}`)
        .groupBy(college.code, college.name),
      tx
        .select({ label: sql<string>`${student.enrolmentYear}::text`, count: sql<number>`count(*)::int` })
        .from(student)
        .groupBy(student.enrolmentYear),
      // COALESCE rather than filtering NULLs out: a breakdown that silently
      // drops the students with no gender recorded would add up to less than
      // the headline total, which is worse than saying so.
      tx
        .select({ label: sql<string>`coalesce(${student.gender}, 'NOT_RECORDED')`, count: sql<number>`count(*)::int` })
        .from(student)
        .groupBy(sql`coalesce(${student.gender}, 'NOT_RECORDED')`),
    ]);

    const byStatus = statusRows.map((r) => ({ label: r.label, count: r.count }));
    return {
      total: byStatus.reduce((sum, r) => sum + r.count, 0),
      byStatus: byStatus.sort((a, b) => b.count - a.count),
      // Ranked by size: the question a college breakdown answers is "which
      // are the big ones", so the chart should not make the reader scan for
      // that.
      byCollege: collegeRows.map((r) => ({ label: r.label, count: r.count })).sort((a, b) => b.count - a.count),
      // Chronological, NOT ranked: this one is a time series, and sorting it
      // by size would destroy the only thing it has to say.
      byEnrolmentYear: yearRows.map((r) => ({ label: r.label, count: r.count })).sort((a, b) => a.label.localeCompare(b.label)),
      // Female, Male, then Not recorded -- a fixed order, because a
      // breakdown of two categories that reorders itself as the numbers
      // move is harder to read across two visits than one that does not.
      byGender: genderRows
        .map((r) => ({ label: GENDER_CHART_LABEL[r.label] ?? r.label, count: r.count }))
        .sort((a, b) => GENDER_ORDER.indexOf(a.label) - GENDER_ORDER.indexOf(b.label)),
    };
  });
}
