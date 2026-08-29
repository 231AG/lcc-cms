import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { NotFoundError } from "@/lib/errors";
import {
  correctHistoricalRecordAction,
  createRetrospectiveSemesterAction,
  enterHistoricalSemesterAction,
  markImportCompleteAction,
  reopenImportStatusAction,
  voidHistoricalRecordAction,
} from "./actions";

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

  const isAdmin = actor.role === "ADMIN";

  if (!studentId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 text-xl font-semibold">Historical import</h1>
        <p className="text-sm text-gray-600">
          Open a student&apos;s record from{" "}
          <Link href="/admin/students" className="text-blue-700 underline">
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
        <main className="mx-auto max-w-lg p-8">
          <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Student not found.
          </p>
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
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">
        {record.firstName} {record.lastName}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        Student ID {record.studentNumber} — {department ? `${department.code} — ${department.name}` : "—"} —{" "}
        <Link href={`/admin/students/${record.id}`} className="text-blue-700 underline">
          Back to profile
        </Link>
      </p>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      {entered && (
        <p className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          Saved {entered} record(s).
          {Number(warnings) > 0 && ` ${warnings} warning(s) -- check the unknown-course entries below.`}
        </p>
      )}

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-2 font-medium">Import status</h2>
        <p className="mb-3 text-sm">
          Current status: <strong>{record.historicalImportStatus}</strong>
          {record.historicalImportStatus !== "COMPLETE" && " -- GPA/CGPA figures for this student are marked provisional everywhere they appear."}
        </p>
        {isAdmin && record.historicalImportStatus !== "COMPLETE" && (
          <form action={markImportCompleteAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
              Mark import Complete
            </button>
          </form>
        )}
        {isAdmin && record.historicalImportStatus === "COMPLETE" && (
          <form action={reopenImportStatusAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="studentId" value={studentId} />
            <div>
              <label htmlFor="reopen-reason" className="mb-1 block text-xs font-medium">
                Reason (required)
              </label>
              <input
                id="reopen-reason"
                name="reason"
                required
                className="w-64 rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
            <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
              Reopen import
            </button>
          </form>
        )}
      </section>

      {isAdmin && (
        <section className="mb-8 rounded border border-gray-200 p-4">
          <h2 className="mb-3 font-medium">Enter a past semester</h2>

          <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="studentId" value={studentId} />
            <div>
              <label htmlFor="semesterId" className="mb-1 block text-xs font-medium">
                Semester
              </label>
              <select
                id="semesterId"
                name="semesterId"
                defaultValue={semesterId ?? ""}
                className="w-72 rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">Select a semester…</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {yearLabel(s.academicYearId)} — {s.name} ({s.state})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
              Select
            </button>
          </form>

          <details className="mb-4">
            <summary className="cursor-pointer text-sm text-blue-700 underline">
              Create a new past semester (created directly Closed)
            </summary>
            <form action={createRetrospectiveSemesterAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={studentId} />
              <div>
                <label htmlFor="academicYearId" className="mb-1 block text-xs font-medium">
                  Academic year
                </label>
                <select id="academicYearId" name="academicYearId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
                  {academicYears.map((y) => (
                    <option key={y.id} value={y.id}>{y.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sequence" className="mb-1 block text-xs font-medium">Sequence</label>
                <select id="sequence" name="sequence" required className="rounded border border-gray-300 px-2 py-1 text-sm">
                  <option value="1">1 (First)</option>
                  <option value="2">2 (Second)</option>
                </select>
              </div>
              <div>
                <label htmlFor="sem-name" className="mb-1 block text-xs font-medium">Name</label>
                <input id="sem-name" name="name" required placeholder="First Semester" className="rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
              <div>
                <label htmlFor="sem-start" className="mb-1 block text-xs font-medium">Start date</label>
                <input id="sem-start" name="startDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
              <div>
                <label htmlFor="sem-end" className="mb-1 block text-xs font-medium">End date</label>
                <input id="sem-end" name="endDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
              <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
                Create semester
              </button>
            </form>
          </details>

          {selectedSemester && (
            <form action={enterHistoricalSemesterAction} className="flex flex-col gap-3">
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="semesterId" value={selectedSemester.id} />
              <p className="text-sm text-gray-600">
                Entering courses for {yearLabel(selectedSemester.academicYearId)} — {selectedSemester.name}
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1">Course code</th>
                    <th className="py-1">Credit hours</th>
                    <th className="py-1">Grade</th>
                    <th className="py-1">Score</th>
                    <th className="py-1">Note</th>
                    <th className="py-1">Repeat?</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: ROW_COUNT }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 pr-1">
                        <input name={`courseCode-${i}`} aria-label={`Course code, row ${i + 1}`} className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-1">
                        <input name={`creditHours-${i}`} aria-label={`Credit hours, row ${i + 1}`} type="number" step="0.5" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-1">
                        <input name={`letter-${i}`} aria-label={`Grade, row ${i + 1}`} className="w-16 rounded border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-1">
                        <input name={`score-${i}`} aria-label={`Score, row ${i + 1}`} type="number" className="w-16 rounded border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-1 pr-1">
                        <input name={`note-${i}`} aria-label={`Note, row ${i + 1}`} className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-1">
                        <input name={`confirmAsRepeat-${i}`} aria-label={`Confirm as repeat, row ${i + 1}`} type="checkbox" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="submit" className="w-fit rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white">
                Save semester
              </button>
            </form>
          )}
        </section>
      )}

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 font-medium">Entered history</h2>
        {history.length === 0 && <p className="text-sm text-gray-500">Nothing entered yet.</p>}
        {history.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Semester</th>
                <th className="py-1">Course</th>
                <th className="py-1">Credits</th>
                <th className="py-1">Grade</th>
                <th className="py-1">Attempt</th>
                {isAdmin && <th className="py-1"></th>}
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const sem = semesters.find((s) => s.id === r.semesterId);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="py-1">{sem ? `${yearLabel(sem.academicYearId)} — ${sem.name}` : r.semesterId}</td>
                    <td className="py-1">
                      {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                      {!r.courseId && <span className="ml-1 text-xs text-amber-700">(not in catalogue)</span>}
                    </td>
                    <td className="py-1">{r.creditHours}</td>
                    <td className="py-1">{r.letter}</td>
                    <td className="py-1">{r.attemptNo}</td>
                    {isAdmin && (
                      <td className="py-1">
                        <details>
                          <summary className="cursor-pointer text-xs text-blue-700 underline">Correct / void</summary>
                          <form action={correctHistoricalRecordAction} className="mt-2 flex flex-wrap items-end gap-1">
                            <input type="hidden" name="studentId" value={studentId} />
                            <input type="hidden" name="recordId" value={r.id} />
                            <input name="letter" placeholder="New grade" defaultValue={r.letter} className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                            <input name="creditHours" type="number" step="0.5" placeholder="Credits" defaultValue={r.creditHours} className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                            <input name="score" type="number" placeholder="Score" defaultValue={r.score ?? ""} className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                            <input name="reason" required placeholder="Reason (required)" className="w-32 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                            <button type="submit" className="text-blue-700 underline">Save correction</button>
                          </form>
                          <form action={voidHistoricalRecordAction} className="mt-1 flex items-center gap-1">
                            <input type="hidden" name="studentId" value={studentId} />
                            <input type="hidden" name="recordId" value={r.id} />
                            <input name="reason" required placeholder="Reason to void" className="w-32 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                            <button type="submit" className="text-red-700 underline">Void</button>
                          </form>
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
