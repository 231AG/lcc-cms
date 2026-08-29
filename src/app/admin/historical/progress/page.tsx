import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getImportProgressReport } from "@/lib/historical/historical";

/**
 * A-16 (plan Section 20.4, REQ-H06), finalised in Stage 11: counts by
 * status; breakdown by College, Department and cohort; a drillable
 * flagged-issue queue (not just a count); records entered per week -- "the
 * figure that reveals a stall, and the only honest basis for estimating
 * completion." Admin and Super Admin both get read access -- there's
 * nothing to write here, only counts.
 */
export default async function ImportProgressPage() {
  const actor = await getCurrentActor();

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
      </main>
    );
  }

  const report = await getImportProgressReport(actor);
  const maxWeekCount = Math.max(1, ...report.recordsEnteredPerWeek.map((w) => w.count));

  if (report.totalStudents === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-1 text-xl font-semibold">Historical import progress</h1>
        <p className="text-sm text-gray-500">Nothing to report yet -- no students have been enrolled.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">Historical import progress</h1>
      <p className="mb-6 text-sm text-gray-500">
        <Link href="/admin/students" className="text-blue-700 underline">
          Students
        </Link>
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Overall</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Status</th>
              <th className="py-1">Students</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.byStatus).map(([status, count]) => (
              <tr key={status} className="border-b">
                <td className="py-1">{status}</td>
                <td className="py-1">{count}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 font-medium">Total</td>
              <td className="py-1 font-medium">{report.totalStudents}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">By College / Department</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">College</th>
                <th className="py-1">Department</th>
                <th className="py-1">Not started</th>
                <th className="py-1">In progress</th>
                <th className="py-1">Complete</th>
                <th className="py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byDepartment.map((d) => (
                <tr key={d.collegeCode + d.departmentCode} className="border-b">
                  <td className="py-1">{d.collegeCode}</td>
                  <td className="py-1">{d.departmentName}</td>
                  <td className="py-1">{d.byStatus.NOT_STARTED ?? 0}</td>
                  <td className="py-1">{d.byStatus.IN_PROGRESS ?? 0}</td>
                  <td className="py-1">{d.byStatus.COMPLETE ?? 0}</td>
                  <td className="py-1 font-medium">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">By cohort (enrolment year)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Year</th>
                <th className="py-1">Not started</th>
                <th className="py-1">In progress</th>
                <th className="py-1">Complete</th>
                <th className="py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byCohort.map((c) => (
                <tr key={c.enrolmentYear} className="border-b">
                  <td className="py-1">{c.enrolmentYear}</td>
                  <td className="py-1">{c.byStatus.NOT_STARTED ?? 0}</td>
                  <td className="py-1">{c.byStatus.IN_PROGRESS ?? 0}</td>
                  <td className="py-1">{c.byStatus.COMPLETE ?? 0}</td>
                  <td className="py-1 font-medium">{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Records entered per week</h2>
        <p className="mb-2 text-xs text-gray-500">Last 12 weeks -- a flat or falling line is a stall, not steady progress.</p>
        <div className="flex h-24 items-end gap-1">
          {report.recordsEnteredPerWeek.map((w) => (
            <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1" title={`${w.weekStart}: ${w.count}`}>
              <div
                className="w-full rounded-t bg-blue-600"
                style={{ height: `${Math.max(2, (w.count / maxWeekCount) * 80)}px` }}
              />
              <span className="text-[10px] text-gray-400">{w.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Flagged issues ({report.unknownCourseIssues})
        </h2>
        {report.flaggedIssues.length === 0 ? (
          <p className="text-sm text-gray-500">No flagged issues.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.flaggedIssues.map((issue, i) => (
              <li key={i} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <span>
                  {issue.studentName} ({issue.studentNumber}) -- course code{" "}
                  <span className="font-mono">{issue.courseCodeSnapshot}</span> not in the catalogue
                </span>
                <Link href={`/admin/students/${issue.studentId}`} className="text-blue-700 underline">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
