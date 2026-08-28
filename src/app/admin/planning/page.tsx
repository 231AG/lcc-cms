import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getPlanQueue } from "@/lib/planning/planning";
import { findPlanAction } from "./actions";

/**
 * A-11 (plan Section 20.4, Stage 9): the queue half -- plans awaiting a
 * decision for a chosen semester. Only SUBMITTED plans appear here
 * (DRAFT plans are "invisible in the Admin approval queue", Section
 * 14.2); the lookup form below reaches a specific student's plan at any
 * status, for applying a prerequisite override before submission
 * (Section 14.5 -- the override exists precisely for the "no historical
 * import yet" case, which blocks submission itself).
 */
export default async function PlanningQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, error } = await searchParams;

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
      </main>
    );
  }

  const [semesters, academicYears, students] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      tx.query.student.findMany(),
    ]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const studentLabel = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${s.firstName} ${s.lastName}` : studentId;
  };

  const queue = semesterId ? await getPlanQueue(actor, semesterId) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Course plan review</h1>

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="semesterId" className="mb-1 block text-xs font-medium">Semester</label>
          <select id="semesterId" name="semesterId" defaultValue={semesterId ?? ""} className="w-72 rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="">Select a semester…</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>{yearLabel(s.id)} ({s.state})</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">Select</button>
      </form>

      {semesterId && (
        <section className="mb-8">
          <h2 className="mb-3 font-medium">Awaiting a decision -- {yearLabel(semesterId)}</h2>
          {queue.length === 0 && <p className="text-sm text-gray-500">No plans awaiting approval.</p>}
          <ul className="flex flex-col gap-2">
            {queue.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
                <span>{studentLabel(p.studentId)} — {p.totalCredits} credit hours</span>
                <Link href={`/admin/planning/${p.id}`} className="text-blue-700 underline">Review</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 font-medium">Look up a specific plan</h2>
        <form action={findPlanAction} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Student ID</label>
            <select name="studentId" required className="w-64 rounded border border-gray-300 px-2 py-1 text-sm">
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.studentNumber} — {s.firstName} {s.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Semester</label>
            <select name="semesterId" required className="w-64 rounded border border-gray-300 px-2 py-1 text-sm">
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>{yearLabel(s.id)}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">Find plan</button>
        </form>
      </section>
    </main>
  );
}
