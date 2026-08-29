import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";

/**
 * Section 11.3's "Run the semester-end export" -- Admin and Super Admin
 * both hold this permission (unlike the audit log, which is Super
 * Admin-only). The actual download is a plain GET route so the browser
 * gets real Content-Disposition/Content-Type headers, not a Server Action.
 */
export default async function ExportPage() {
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

  const [years, semesters] = await asUser(actor.userId, async (tx) => {
    return Promise.all([
      tx.query.academicYear.findMany({ orderBy: (row, { desc }) => desc(row.label) }),
      tx.query.semester.findMany({ orderBy: (row, { desc }) => [desc(row.academicYearId), desc(row.sequence)] }),
    ]);
  });

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? id;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold">Semester-end academic data export</h1>
      <p className="mb-6 text-sm text-gray-600">
        A full copy of a semester&apos;s academic data leaves the system when you download it. Every export is
        recorded in the audit log.
      </p>

      {semesters.length === 0 && <p className="text-sm text-gray-500">No semesters exist yet.</p>}

      <ul className="flex flex-col gap-2">
        {semesters.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
            <span>
              {yearLabel(s.academicYearId)} — {s.name} <span className="text-xs text-gray-500">({s.state})</span>
            </span>
            <a href={`/admin/export/${s.id}`} className="text-blue-700 underline">
              Download CSV
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
