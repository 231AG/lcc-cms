import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getImportProgressReport } from "@/lib/historical/historical";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";

export const metadata: Metadata = { title: "Historical import progress" };

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

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const report = await getImportProgressReport(actor);
  const maxWeekCount = Math.max(1, ...report.recordsEnteredPerWeek.map((w) => w.count));

  if (report.totalStudents === 0) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
        <PageHeader title="Historical import progress" />
        <p className="text-sm text-neutral-500">Nothing to report yet -- no students have been enrolled.</p>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title="Historical import progress"
        description={
          <Link href="/admin/students" className="font-medium text-brand-700 hover:underline">
            Students
          </Link>
        }
      />

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Overall</h2>
        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Status</Th>
                <Th>Students</Th>
              </tr>
            </Thead>
            <tbody>
              {Object.entries(report.byStatus).map(([status, count]) => (
                <Tr key={status}>
                  <Td>{status}</Td>
                  <Td>{count}</Td>
                </Tr>
              ))}
              <Tr>
                <Td className="font-semibold text-neutral-900">Total</Td>
                <Td className="font-semibold text-neutral-900">{report.totalStudents}</Td>
              </Tr>
            </tbody>
          </Table>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">By College / Department</h2>
        <Card>
          <Table className="min-w-[500px]">
            <Thead>
              <tr>
                <Th>College</Th>
                <Th>Department</Th>
                <Th>Not started</Th>
                <Th>In progress</Th>
                <Th>Complete</Th>
                <Th>Total</Th>
              </tr>
            </Thead>
            <tbody>
              {report.byDepartment.map((d) => (
                <Tr key={d.collegeCode + d.departmentCode}>
                  <Td>{d.collegeCode}</Td>
                  <Td>{d.departmentName}</Td>
                  <Td>{d.byStatus.NOT_STARTED ?? 0}</Td>
                  <Td>{d.byStatus.IN_PROGRESS ?? 0}</Td>
                  <Td>{d.byStatus.COMPLETE ?? 0}</Td>
                  <Td className="font-medium text-neutral-900">{d.total}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">By cohort (enrolment year)</h2>
        <Card>
          <Table className="min-w-[400px]">
            <Thead>
              <tr>
                <Th>Year</Th>
                <Th>Not started</Th>
                <Th>In progress</Th>
                <Th>Complete</Th>
                <Th>Total</Th>
              </tr>
            </Thead>
            <tbody>
              {report.byCohort.map((c) => (
                <Tr key={c.enrolmentYear}>
                  <Td>{c.enrolmentYear}</Td>
                  <Td>{c.byStatus.NOT_STARTED ?? 0}</Td>
                  <Td>{c.byStatus.IN_PROGRESS ?? 0}</Td>
                  <Td>{c.byStatus.COMPLETE ?? 0}</Td>
                  <Td className="font-medium text-neutral-900">{c.total}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Records entered per week</h2>
        <p className="mb-2 text-xs text-neutral-500">Last 12 weeks -- a flat or falling line is a stall, not steady progress.</p>
        <Card className="p-4">
          <div className="flex h-24 items-end gap-1">
            {report.recordsEnteredPerWeek.map((w) => (
              <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1" title={`${w.weekStart}: ${w.count}`}>
                <div
                  className="w-full rounded-t bg-brand-600"
                  style={{ height: `${Math.max(2, (w.count / maxWeekCount) * 80)}px` }}
                />
                <span className="text-[10px] text-neutral-400">{w.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Flagged issues ({report.unknownCourseIssues})</h2>
        {report.flaggedIssues.length === 0 ? (
          <p className="text-sm text-neutral-500">No flagged issues.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.flaggedIssues.map((issue, i) => (
              <li key={i}>
                <Card className="flex items-center justify-between border-warning-200 bg-warning-50 px-3 py-2 text-sm">
                  <span>
                    {issue.studentName} ({issue.studentNumber}) -- course code{" "}
                    <span className="font-mono">{issue.courseCodeSnapshot}</span> not in the catalogue
                  </span>
                  <Link href={`/admin/students/${issue.studentId}`} className="font-medium text-brand-700 hover:underline">
                    Review
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
