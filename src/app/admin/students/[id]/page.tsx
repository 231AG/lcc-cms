import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent, STUDENT_STATUSES } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { NotFoundError } from "@/lib/errors";
import { updateStudentProfileAction } from "../actions";
import { ResetPasswordForm } from "../ResetPasswordForm";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * A-10 (plan Section 20.5). Stage 5 built this as structure only; Stage 6
 * added entered history; Stage 7 adds GPA/CGPA, academic standing, and
 * outstanding mandatory repeats (plans and system grades are Stages 9/10).
 */
export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { id } = await params;
  const { error } = await searchParams;

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

  let record;
  try {
    record = await getStudent(actor, id);
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

  const [departments, history, semesters, academicYears, semesterSummaries, cumulative, obligations] = await asUser(
    actor.userId,
    (tx) =>
      Promise.all([
        tx.query.department.findMany({ orderBy: (d, { asc }) => asc(d.code) }),
        getStudentHistory(actor, record.id),
        tx.query.semester.findMany(),
        tx.query.academicYear.findMany(),
        getSemesterSummaries(actor, record.id),
        getCumulativeSummary(actor, record.id),
        getOutstandingRepeatObligations(actor, record.id),
      ]),
  );
  const semesterSummaryFor = (semesterId: string) => semesterSummaries.find((s) => s.semesterId === semesterId);
  const yearLabel = (semesterId: string) => {
    const sem = semesters.find((s) => s.id === semesterId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semesterId;
  };

  const isAdmin = actor.role === "ADMIN";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">
        {record.firstName} {record.lastName}
      </h1>
      <p className="mb-6 text-sm text-gray-500">Student ID {record.studentNumber}</p>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-3 font-medium">Profile</h2>
        <form action={updateStudentProfileAction} className="flex flex-col gap-3">
          <input type="hidden" name="studentId" value={record.id} />
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="firstName" className="mb-1 block text-xs font-medium">
                First name
              </label>
              <input
                id="firstName"
                name="firstName"
                defaultValue={record.firstName}
                disabled={!isAdmin}
                required
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="lastName" className="mb-1 block text-xs font-medium">
                Last name
              </label>
              <input
                id="lastName"
                name="lastName"
                defaultValue={record.lastName}
                disabled={!isAdmin}
                required
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
          <div>
            <label htmlFor="departmentId" className="mb-1 block text-xs font-medium">
              Department
            </label>
            <select
              id="departmentId"
              name="departmentId"
              defaultValue={record.departmentId}
              disabled={!isAdmin}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="enrolmentYear" className="mb-1 block text-xs font-medium">
              Enrolment year
            </label>
            <input
              id="enrolmentYear"
              name="enrolmentYear"
              type="number"
              defaultValue={record.enrolmentYear}
              disabled={!isAdmin}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label htmlFor="contactPhone" className="mb-1 block text-xs font-medium">
              Contact phone
            </label>
            <input
              id="contactPhone"
              name="contactPhone"
              defaultValue={record.contactPhone ?? ""}
              disabled={!isAdmin}
              className="w-full max-w-xs rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-xs font-medium">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={record.status}
              disabled={!isAdmin}
              className="w-full max-w-xs rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
            >
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">Import status: {record.historicalImportStatus}</p>
          {isAdmin && (
            <button
              type="submit"
              className="w-fit rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white"
            >
              Save changes
            </button>
          )}
        </form>
      </section>

      {isAdmin && (
        <section className="mb-8 rounded border border-gray-200 p-4">
          <h2 className="mb-1 font-medium">Reset password</h2>
          <p className="text-xs text-gray-500">Issues a new temporary password and forces a change on next login.</p>
          <ResetPasswordForm studentId={record.id} />
        </section>
      )}

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-2 font-medium">GPA and CGPA</h2>
        {(cumulative?.isProvisional ?? true) && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Provisional -- based on records entered so far.
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">CGPA</dt>
          <dd>{cumulative?.cgpa ?? "—"}</dd>
          <dt className="text-gray-500">Academic standing</dt>
          <dd>{cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}</dd>
          <dt className="text-gray-500">Credits earned</dt>
          <dd>{cumulative ? `${cumulative.totalCreditsEarned} of 132 -- ${cumulative.creditsToGraduation} remaining` : "—"}</dd>
          <dt className="text-gray-500">Credits attempted</dt>
          <dd>{cumulative?.totalCreditsAttempted ?? "—"}</dd>
        </dl>
        {obligations.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-amber-800">Outstanding mandatory repeats:</p>
            <ul className="list-disc pl-5 text-sm">
              {obligations.map((o) => (
                <li key={o.recordId}>
                  {o.courseCode} — {o.courseTitle} ({o.letter})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded border border-gray-200 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Academic history</h2>
          {isAdmin && (
            <Link href={`/admin/historical?studentId=${record.id}`} className="text-sm text-blue-700 underline">
              Enter historical record
            </Link>
          )}
        </div>
        {history.length === 0 && (
          <p className="text-sm text-gray-500">
            Empty -- the import status above explains why nothing appears here yet.
          </p>
        )}
        {history.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Semester</th>
                <th className="py-1">Course</th>
                <th className="py-1">Credits</th>
                <th className="py-1">Grade</th>
                <th className="py-1">Semester GPA</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => {
                const showSemesterGpa = i === 0 || history[i - 1].semesterId !== r.semesterId;
                const summary = semesterSummaryFor(r.semesterId);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="py-1">{yearLabel(r.semesterId)}</td>
                    <td className="py-1">
                      {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                    </td>
                    <td className="py-1">{r.creditHours}</td>
                    <td className="py-1">
                      {r.letter}
                      {r.isRepeatDropped && " (R)"}
                    </td>
                    <td className="py-1">{showSemesterGpa ? (summary?.gpa ?? "—") : ""}</td>
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
