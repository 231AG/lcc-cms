import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import {
  correctHistoricalRecordAction,
  createRetrospectiveSemesterAction,
  enterHistoricalSemesterAction,
  markImportCompleteAction,
  reopenImportStatusAction,
  voidHistoricalRecordAction,
} from "./actions";

export const metadata: Metadata = { title: "Historical import" };

const ROW_COUNT = 8;

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
  searchParams: Promise<{ studentId?: string; semesterId?: string; error?: string; entered?: string; warnings?: string }>;
}) {
  const actor = await getCurrentActor();
  const { studentId, semesterId, error, entered, warnings } = await searchParams;

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
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
        <PageHeader title="Historical import" />
        <p className="text-sm text-neutral-600">
          Open a student&apos;s record from{" "}
          <Link href="/admin/students" className="font-medium text-brand-700 hover:underline">
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
  const selectedSemester = semesterId ? semesters.find((s) => s.id === semesterId) : undefined;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title={
          <>
            {record.firstName} {record.lastName}
          </>
        }
        description={
          <>
            Student ID {record.studentNumber} — {department ? `${department.code} — ${department.name}` : "—"} —{" "}
            <Link href={`/admin/students/${record.id}`} className="font-medium text-brand-700 hover:underline">
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
      {entered && (
        <Alert tone="success" className="mb-4">
          Saved {entered} record(s).
          {Number(warnings) > 0 && ` ${warnings} warning(s) -- check the unknown-course entries below.`}
        </Alert>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Import status</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-neutral-700">
            Current status: <strong className="text-neutral-900">{record.historicalImportStatus}</strong>
            {record.historicalImportStatus !== "COMPLETE" && " -- GPA/CGPA figures for this student are marked provisional everywhere they appear."}
          </p>
          {isAdmin && record.historicalImportStatus !== "COMPLETE" && (
            <form action={markImportCompleteAction}>
              <input type="hidden" name="studentId" value={studentId} />
              <Button type="submit">Mark import Complete</Button>
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
              <Button type="submit" variant="secondary">
                Reopen import
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      {isAdmin && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Enter a past semester</CardTitle>
          </CardHeader>
          <CardBody>
            <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={studentId} />
              <div>
                <Label htmlFor="semesterId" className="text-xs">
                  Semester
                </Label>
                <Select id="semesterId" name="semesterId" defaultValue={semesterId ?? ""} className="w-72">
                  <option value="">Select a semester…</option>
                  {semesters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {yearLabel(s.academicYearId)} — {s.name} ({s.state})
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="secondary">
                Select
              </Button>
            </form>

            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">
                Create a new past semester (created directly Closed)
              </summary>
              <form action={createRetrospectiveSemesterAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="studentId" value={studentId} />
                <div>
                  <Label htmlFor="academicYearId" className="text-xs">
                    Academic year
                  </Label>
                  <Select id="academicYearId" name="academicYearId" required>
                    {academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sequence" className="text-xs">
                    Sequence
                  </Label>
                  <Select id="sequence" name="sequence" required>
                    <option value="1">1 (First)</option>
                    <option value="2">2 (Second)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sem-name" className="text-xs">
                    Name
                  </Label>
                  <Input id="sem-name" name="name" required placeholder="First Semester" />
                </div>
                <div>
                  <Label htmlFor="sem-start" className="text-xs">
                    Start date
                  </Label>
                  <Input id="sem-start" name="startDate" type="date" required />
                </div>
                <div>
                  <Label htmlFor="sem-end" className="text-xs">
                    End date
                  </Label>
                  <Input id="sem-end" name="endDate" type="date" required />
                </div>
                <Button type="submit" variant="secondary">
                  Create semester
                </Button>
              </form>
            </details>

            {selectedSemester && (
              <form action={enterHistoricalSemesterAction} className="flex flex-col gap-3">
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="semesterId" value={selectedSemester.id} />
                <p className="text-sm text-neutral-600">
                  Entering courses for {yearLabel(selectedSemester.academicYearId)} — {selectedSemester.name}
                </p>
                <Table>
                  <Thead>
                    <tr>
                      <Th>Course code</Th>
                      <Th>Credit hours</Th>
                      <Th>Grade</Th>
                      <Th>Score</Th>
                      <Th>Note</Th>
                      <Th>Repeat?</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {Array.from({ length: ROW_COUNT }).map((_, i) => (
                      <Tr key={i}>
                        <Td>
                          <Input name={`courseCode-${i}`} aria-label={`Course code, row ${i + 1}`} className="w-28" />
                        </Td>
                        <Td>
                          <Input name={`creditHours-${i}`} aria-label={`Credit hours, row ${i + 1}`} type="number" step="0.5" className="w-20" />
                        </Td>
                        <Td>
                          <Input name={`letter-${i}`} aria-label={`Grade, row ${i + 1}`} className="w-16" />
                        </Td>
                        <Td>
                          <Input name={`score-${i}`} aria-label={`Score, row ${i + 1}`} type="number" className="w-16" />
                        </Td>
                        <Td>
                          <Input name={`note-${i}`} aria-label={`Note, row ${i + 1}`} className="w-32" />
                        </Td>
                        <Td>
                          <input name={`confirmAsRepeat-${i}`} aria-label={`Confirm as repeat, row ${i + 1}`} type="checkbox" />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Button type="submit" className="w-fit">
                  Save semester
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Entered history</CardTitle>
        </CardHeader>
        <CardBody>
          {history.length === 0 && <p className="text-sm text-neutral-500">Nothing entered yet.</p>}
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
                      <Td>{sem ? `${yearLabel(sem.academicYearId)} — ${sem.name}` : r.semesterId}</Td>
                      <Td>
                        {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                        {!r.courseId && <span className="ml-1 text-xs text-warning-700">(not in catalogue)</span>}
                      </Td>
                      <Td>{r.creditHours}</Td>
                      <Td>{r.letter}</Td>
                      <Td>{r.attemptNo}</Td>
                      {isAdmin && (
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">Correct / void</summary>
                            <form action={correctHistoricalRecordAction} className="mt-2 flex flex-wrap items-end gap-1">
                              <input type="hidden" name="studentId" value={studentId} />
                              <input type="hidden" name="recordId" value={r.id} />
                              <input name="letter" placeholder="New grade" defaultValue={r.letter} className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
                              <input name="creditHours" type="number" step="0.5" placeholder="Credits" defaultValue={r.creditHours} className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
                              <input name="score" type="number" placeholder="Score" defaultValue={r.score ?? ""} className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
                              <input name="reason" required placeholder="Reason (required)" className="w-32 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
                              <button type="submit" className="font-medium text-brand-700 hover:underline">
                                Save correction
                              </button>
                            </form>
                            <form action={voidHistoricalRecordAction} className="mt-1 flex items-center gap-1">
                              <input type="hidden" name="studentId" value={studentId} />
                              <input type="hidden" name="recordId" value={r.id} />
                              <input name="reason" required placeholder="Reason to void" className="w-32 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
                              <button type="submit" className="font-medium text-danger-600 hover:underline">
                                Void
                              </button>
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
