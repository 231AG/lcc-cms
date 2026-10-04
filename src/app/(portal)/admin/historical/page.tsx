import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { fullName } from "@/lib/students/name";
import { asUser } from "@/lib/db/asUser";
import { getStudent } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Label, Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { buttonClasses } from "@/components/ui/Button";
import {
  correctHistoricalRecordAction,
  markImportCompleteAction,
  reopenImportStatusAction,
  voidHistoricalRecordAction,
} from "./actions";

export const metadata: Metadata = { title: "Historical import" };

/**
 * A-15 (plan Section 20.4, Stage 6): historical entry, one semester at a
 * time, one save. Reached from a student's own record (A-10) with
 * ?studentId= set. Admin gets the entry form and status controls; Super
 * Admin sees the same student's entered history read-only, same "one
 * page, role-conditional controls" pattern as /admin/calendar.
 */
export default async function HistoricalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { studentId, error } = await searchParams;

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

  const isAdmin = actor.role === "ADMIN";

  if (!studentId) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
        <PageHeader title="Historical import" />
        <p className="text-sm text-fg-secondary">
          Open a student&apos;s record from{" "}
          <Link href="/admin/students" className="font-medium text-brand-fg hover:underline">
            Students
          </Link>{" "}
          and use &quot;Enter historical record&quot; to get here with a student selected.
        </p>
      </main>
    );
  }

  let record;
  try {
    record = await getStudent(actor, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
          <Alert tone="info">Student not found.</Alert>
        </main>
      );
    }
    throw err;
  }

  const [history, academicYears, semesters, department] = await asUser(actor.userId, async (tx) =>
    Promise.all([
      getStudentHistory(actor, studentId),
      tx.query.academicYear.findMany({ orderBy: (y, { desc }) => desc(y.label) }),
      tx.query.semester.findMany({ orderBy: (s, { desc }) => [desc(s.academicYearId), desc(s.sequence)] }),
      tx.query.department.findFirst({ where: (d, { eq }) => eq(d.id, record.departmentId) }),
    ]),
  );

  const yearLabel = (id: string) => academicYears.find((y) => y.id === id)?.label ?? id;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader
        title={
          <>
            {fullName(record)}
          </>
        }
        description={
          <>
            Student ID {record.studentNumber} — {department ? `${department.code} — ${department.name}` : "—"} —{" "}
            <Link href={`/admin/students/${record.id}`} className="font-medium text-brand-fg hover:underline">
              Back to profile
            </Link>
          </>
        }
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Import status</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-fg-secondary">
            Current status: <strong className="text-fg">{record.historicalImportStatus}</strong>
            {record.historicalImportStatus !== "COMPLETE" && " -- GPA/CGPA figures for this student are marked provisional everywhere they appear."}
          </p>
          {isAdmin && record.historicalImportStatus !== "COMPLETE" && (
            <form action={markImportCompleteAction}>
              <input type="hidden" name="studentId" value={studentId} />
              <SubmitButton>Mark import Complete</SubmitButton>
            </form>
          )}
          {isAdmin && record.historicalImportStatus === "COMPLETE" && (
            <form action={reopenImportStatusAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={studentId} />
              <div>
                <Label htmlFor="reopen-reason" className="text-xs">
                  Reason (required)
                </Label>
                <Input id="reopen-reason" name="reason" required className="w-64" />
              </div>
              <SubmitButton variant="secondary">
                Reopen import
              </SubmitButton>
            </form>
          )}
        </CardBody>
      </Card>

      {isAdmin && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Add past grades</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-fg-secondary">
              Past semesters are entered on Import past grades: pick the year and semester, search the catalogue for each course, and the
              grade points and GPA are worked out for you.
            </p>
            <Link href={`/admin/historical/import?tab=hand&studentId=${studentId}`} className={buttonClasses("primary", "sm")}>
              Add past grades
            </Link>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Entered history</CardTitle>
        </CardHeader>
        <CardBody>
          {history.length === 0 && <p className="text-sm text-fg-muted">Nothing entered yet.</p>}
          {history.length > 0 && (
            <Table>
              <Thead>
                <tr>
                  <Th>Semester</Th>
                  <Th>Course</Th>
                  <Th>Credits</Th>
                  <Th>Grade</Th>
                  <Th>Attempt</Th>
                  {isAdmin && <Th></Th>}
                </tr>
              </Thead>
              <tbody>
                {history.map((r) => {
                  const sem = semesters.find((s) => s.id === r.semesterId);
                  return (
                    <Tr key={r.id}>
                      <Td>{sem ? `${yearLabel(sem.academicYearId)} — ${semesterDisplayName(sem)}` : r.semesterId}</Td>
                      <Td>
                        {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                        {!r.courseId && <span className="ml-1 text-xs text-warning-fg">(not in catalogue)</span>}
                      </Td>
                      <Td>{r.creditHours}</Td>
                      <Td>{r.letter}</Td>
                      <Td>{r.attemptNo}</Td>
                      {isAdmin && (
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand-fg hover:underline">Correct / void</summary>
                            <form action={correctHistoricalRecordAction} className="mt-2 flex flex-wrap items-end gap-1">
                              <input type="hidden" name="studentId" value={studentId} />
                              <input type="hidden" name="recordId" value={r.id} />
                              <input name="letter" placeholder="New grade" defaultValue={r.letter} className="w-16 rounded border border-line-strong px-1 py-0.5 text-xs" />
                              <input name="creditHours" type="number" step="0.5" placeholder="Credits" defaultValue={r.creditHours} className="w-16 rounded border border-line-strong px-1 py-0.5 text-xs" />
                              <input name="score" type="number" placeholder="Score" defaultValue={r.score ?? ""} className="w-16 rounded border border-line-strong px-1 py-0.5 text-xs" />
                              <input name="reason" required placeholder="Reason (required)" className="w-32 rounded border border-line-strong px-1 py-0.5 text-xs" />
                              <SubmitTextButton className="font-medium text-brand-fg hover:underline">
                                Save correction
                              </SubmitTextButton>
                            </form>
                            <form action={voidHistoricalRecordAction} className="mt-1 flex items-center gap-1">
                              <input type="hidden" name="studentId" value={studentId} />
                              <input type="hidden" name="recordId" value={r.id} />
                              <input name="reason" required placeholder="Reason to void" className="w-32 rounded border border-line-strong px-1 py-0.5 text-xs" />
                              <SubmitTextButton className="font-medium text-danger-fg hover:underline">
                                Void
                              </SubmitTextButton>
                            </form>
                          </details>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
