import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { listNoGradeRecords } from "@/lib/grades/noGrade";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";

export const metadata: Metadata = { title: "NG to settle" };

const recordLink =
  "text-brand-fg hover:text-brand-fg-hover rounded-md text-sm font-medium whitespace-nowrap hover:underline " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * Every NG (No Grade) on file and the semester it must be settled by. An
 * NG not settled by then is recorded as F -- by an Admin, with a reason,
 * on the student's past-record page; nothing changes a grade on its own.
 */
export default async function NoGradesPage() {
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

  const rows = await listNoGradeRecords(actor);
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "NG to settle" }]} />
      <PageHeader
        title="NG to settle"
        description="An NG (No Grade) is not counted and must be settled within two semesters. Once its deadline semester has ended it is overdue and must be recorded as F, unless the final grade has been given."
      />

      {overdue > 0 && (
        <Alert tone="warning" className="mb-4">
          {overdue} {overdue === 1 ? "NG is" : "NGs are"} overdue. Record each as F, or as the final grade if one was given, on the
          student&rsquo;s past-record page.
        </Alert>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-fg-muted text-sm">No student has an NG on record.</p>
          </CardBody>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th className="text-left">Student</Th>
                <Th className="text-left">ID</Th>
                <Th className="text-left">Course</Th>
                <Th className="text-center">Cr/Hrs</Th>
                <Th className="text-left">Given in</Th>
                <Th className="text-left">Settle by end of</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-left">Record</Th>
              </tr>
            </Thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.recordId}>
                  <Td className="text-fg font-semibold whitespace-nowrap">{r.studentName}</Td>
                  <Td className="tabular-nums">{r.studentNumber}</Td>
                  <Td>
                    <span className="whitespace-nowrap">{r.courseCode}</span>
                    <span className="text-fg-muted block text-xs">{r.courseTitle}</span>
                  </Td>
                  <Td className="text-center tabular-nums">{r.creditHours}</Td>
                  <Td className="whitespace-nowrap">{r.semesterLabel}</Td>
                  <Td className="whitespace-nowrap">{r.settleBy}</Td>
                  <Td>
                    {r.overdue ? (
                      <span className="text-danger-fg inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Overdue: record as F
                      </span>
                    ) : (
                      <span className="text-fg-secondary text-sm whitespace-nowrap">Within time</span>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={r.isImported ? `/admin/historical?studentId=${r.studentId}` : "/admin/grade-corrections"}
                      className={recordLink}
                    >
                      {actor.role === "ADMIN" ? "Record the grade" : "View record"}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
