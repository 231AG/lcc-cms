import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent, STUDENT_STATUSES } from "@/lib/students/students";
import { NotFoundError } from "@/lib/errors";
import { updateStudentProfileAction } from "../actions";
import { ResetPasswordForm } from "../ResetPasswordForm";

/**
 * A-10 (plan Section 20.5), built in Stage 5 only as "structure, empty of
 * history" -- full academic history population comes with Stages 6, 7, 9,
 * 10. Admin edits every field here (name, department, enrolment year,
 * contact, status); Super Admin sees the same page read-only.
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

  const departments = await asUser(actor.userId, (tx) =>
    tx.query.department.findMany({ orderBy: (d, { asc }) => asc(d.code) }),
  );

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

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-1 font-medium">Academic history</h2>
        <p className="text-sm text-gray-500">
          Empty -- historical records are entered in a later stage; the import status above explains why nothing appears here yet.
        </p>
      </section>
    </main>
  );
}
