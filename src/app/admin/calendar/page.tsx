import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { legalNextStates, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { createAcademicYearAction, createSemesterAction, transitionSemesterAction } from "./actions";

/**
 * Academic years, semesters, and state transitions (Section 20.4, Stage 4).
 * Visible to both Admin (create years/semesters, advance forward) and Super
 * Admin (move backward/reopen, with a mandatory reason) -- unlike
 * /admin/structure, which is Admin-only, this screen has real content for
 * both roles, matching Section 11.3's "Advance forward is Admin-only, move
 * backwards is Super-Admin-only" split rather than a single-role screen.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
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

  const [years, semesters] = await asUser(actor.userId, async (tx) => {
    return Promise.all([
      tx.query.academicYear.findMany({ orderBy: (row, { asc }) => asc(row.label) }),
      tx.query.semester.findMany({ orderBy: (row, { asc }) => [asc(row.academicYearId), asc(row.sequence)] }),
    ]);
  });

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? id;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Academic calendar</h1>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* Academic years */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium">Academic years</h2>

        {actor.role === "ADMIN" && (
          <form action={createAcademicYearAction} className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="year-label">Label</label>
              <input id="year-label" name="label" required placeholder="2026/2027" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="year-start">Start date</label>
              <input id="year-start" name="startDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="year-end">End date</label>
              <input id="year-end" name="endDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
              Add academic year
            </button>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Label</th>
              <th className="py-1">Start</th>
              <th className="py-1">End</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id} className="border-b">
                <td className="py-1">{y.label}</td>
                <td className="py-1">{y.startDate}</td>
                <td className="py-1">{y.endDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Semesters */}
      <section>
        <h2 className="mb-3 font-medium">Semesters</h2>

        {actor.role === "ADMIN" && (
          <form action={createSemesterAction} className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="sem-year">Academic year</label>
              <select id="sem-year" name="academicYearId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
                {years.map((y) => (
                  <option key={y.id} value={y.id}>{y.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="sem-sequence">Sequence</label>
              <select id="sem-sequence" name="sequence" required className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="1">1 (First)</option>
                <option value="2">2 (Second)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="sem-name">Name</label>
              <input id="sem-name" name="name" required placeholder="First Semester" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="sem-start">Start date</label>
              <input id="sem-start" name="startDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="sem-end">End date</label>
              <input id="sem-end" name="endDate" type="date" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
              Add semester
            </button>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Academic year</th>
              <th className="py-1">Seq</th>
              <th className="py-1">Name</th>
              <th className="py-1">State</th>
              <th className="py-1">Transition</th>
            </tr>
          </thead>
          <tbody>
            {semesters.map((s) => {
              const currentState = s.state as SemesterState;
              const availableRules = legalNextStates(currentState).filter((r) => r.actorRole === actor.role);
              return (
                <tr key={s.id} className="border-b align-top">
                  <td className="py-1">{yearLabel(s.academicYearId)}</td>
                  <td className="py-1">{s.sequence}</td>
                  <td className="py-1">{s.name}</td>
                  <td className="py-1">{s.state}</td>
                  <td className="py-1">
                    {availableRules.length === 0 && (
                      <span className="text-gray-400">
                        {actor.role === "ADMIN" ? "No forward move available" : "No backward move available"}
                      </span>
                    )}
                    <div className="flex flex-col gap-2">
                      {availableRules.map((rule) => (
                        <form key={rule.to} action={transitionSemesterAction} className="flex items-end gap-2">
                          <input type="hidden" name="semesterId" value={s.id} />
                          <input type="hidden" name="toState" value={rule.to} />
                          {rule.reasonRequired && (
                            <input
                              name="reason"
                              required
                              placeholder="Reason (required)"
                              className="w-48 rounded border border-gray-300 px-2 py-1 text-xs"
                            />
                          )}
                          <button type="submit" className="rounded border border-blue-700 px-2 py-1 text-xs font-medium text-blue-700">
                            {rule.actorRole === "ADMIN" ? "Advance to" : "Move back to"} {rule.to}
                          </button>
                        </form>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
