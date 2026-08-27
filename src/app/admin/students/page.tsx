import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { searchStudents, STUDENT_STATUSES } from "@/lib/students/students";
import { EnrollStudentForm } from "./EnrollStudentForm";

/**
 * A-09 (Admin: search, enrol, quick links to edit) and X-07 (Super Admin:
 * same search, read-only -- Section 20.5/20.6) combined onto one page, the
 * same "one page, role-conditional controls" pattern /admin/calendar
 * already uses for Admin vs Super Admin.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { q, status, page, error } = await searchParams;

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

  const pageNum = Math.max(1, Number(page) || 1);
  const [results, departments] = await Promise.all([
    searchStudents(actor, {
      query: q,
      status: status && (STUDENT_STATUSES as readonly string[]).includes(status) ? (status as (typeof STUDENT_STATUSES)[number]) : undefined,
      page: pageNum,
    }),
    actor.role === "ADMIN"
      ? asUser(actor.userId, (tx) => tx.query.department.findMany({ where: (d, { eq }) => eq(d.isActive, true), orderBy: (d, { asc }) => asc(d.code) }))
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Students</h1>
        <Link href="/admin/historical/progress" className="text-sm text-blue-700 underline">
          Historical import progress
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {actor.role === "ADMIN" && <EnrollStudentForm departments={departments.map((d) => ({ id: d.id, code: d.code, name: d.name }))} />}

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="q" className="mb-1 block text-xs font-medium">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Student ID or name"
            className="w-56 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className="rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
          Search
        </button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Student ID</th>
            <th className="py-1">Name</th>
            <th className="py-1">Status</th>
            <th className="py-1">Enrolment year</th>
            <th className="py-1">Import status</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {results.rows.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="py-1">{s.studentNumber}</td>
              <td className="py-1">{s.lastName}, {s.firstName}</td>
              <td className="py-1">{s.status}</td>
              <td className="py-1">{s.enrolmentYear}</td>
              <td className="py-1">{s.historicalImportStatus}</td>
              <td className="py-1">
                <Link href={`/admin/students/${s.id}`} className="text-blue-700 underline">
                  {actor.role === "ADMIN" ? "Edit" : "View"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {results.rows.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">
          {q || status ? "No students match this search." : "No students enrolled yet."}
        </p>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {pageNum > 1 && (
            <Link href={`/admin/students?q=${encodeURIComponent(q ?? "")}&status=${encodeURIComponent(status ?? "")}&page=${pageNum - 1}`} className="text-blue-700 underline">
              Previous
            </Link>
          )}
          <span>
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link href={`/admin/students?q=${encodeURIComponent(q ?? "")}&status=${encodeURIComponent(status ?? "")}&page=${pageNum + 1}`} className="text-blue-700 underline">
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
