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

export interface CountByLabel {
  label: string;
  count: number;
}

export interface StudentStatistics {
  total: number;
  byStatus: CountByLabel[];
  byCollege: CountByLabel[];
  byEnrolmentYear: CountByLabel[];
}

export async function getStudentStatistics(actor: Actor): Promise<StudentStatistics> {
  return asUser(actor.userId, async (tx) => {
    const [statusRows, collegeRows, yearRows] = await Promise.all([
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
    };
  });
}
