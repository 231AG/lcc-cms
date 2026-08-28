import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getClassRoster } from "@/lib/grades/grades";
import ClassEntryForm from "./ClassEntryForm";
import { submitClassAction } from "./actions";

/**
 * A-12 (plan Section 20.6, Stage 10): class grade entry. Admin only
 * (REQ-R04 -- a Super Admin can publish a grade but never enter or alter
 * one, Section 15.1).
 */
export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; offeringId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, offeringId, error } = await searchParams;

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

  const [semesters, academicYears, offerings, courses, scale] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      semesterId ? tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.semesterId, semesterId) }) : Promise.resolve([]),
      tx.query.course.findMany(),
      tx.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    ]),
  );
  const activeVersion = scale.length > 0 ? Math.max(...scale.map((s) => s.policyVersion)) : 0;
  const activeScale = scale.filter((s) => s.policyVersion === activeVersion);

  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courses.find((c) => c.id === o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };

  const roster = offeringId ? await getClassRoster(actor, offeringId) : [];
  const rosterRows = roster.map((r) => ({
    registrationId: r.registrationId,
    studentNumber: r.studentNumber,
    studentName: r.studentName,
    isRetake: r.isRetake,
    gradeId: r.grade?.id ?? null,
    currentScore: r.grade?.score ?? null,
    currentLetter: r.grade?.letter ?? null,
    currentVersion: r.grade?.version ?? null,
    status: r.grade?.status ?? null,
  }));
  const enteredCount = rosterRows.filter((r) => r.gradeId).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Class grade entry</h1>

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Semester</label>
          <select name="semesterId" defaultValue={semesterId ?? ""} className="w-72 rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="">Select a semester…</option>
            {semesters
              .filter((s) => s.state === "GRADE_SUBMISSION")
              .map((s) => (
                <option key={s.id} value={s.id}>{yearLabel(s.id)}</option>
              ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">Select</button>
      </form>

      {semesterId && (
        <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
          <input type="hidden" name="semesterId" value={semesterId} />
          <div>
            <label className="mb-1 block text-xs font-medium">Class</label>
            <select name="offeringId" defaultValue={offeringId ?? ""} className="w-96 rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="">Select a class…</option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>{offeringLabel(o)}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">Select</button>
        </form>
      )}

      {offeringId && (
        <>
          <p className="mb-3 text-sm text-gray-500">{enteredCount} of {rosterRows.length} entered</p>
          {rosterRows.length === 0 ? (
            <p className="text-sm text-gray-500">No registered students in this class.</p>
          ) : (
            <>
              <ClassEntryForm offeringId={offeringId} roster={rosterRows} scale={activeScale} />
              <section className="mt-6 rounded border border-gray-200 p-4">
                <h2 className="mb-2 font-medium">Submit for approval</h2>
                <form action={submitClassAction} className="flex flex-col gap-2">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="confirmPartial" />
                    Confirm submitting with missing grades
                  </label>
                  <input name="partialNote" placeholder="Note (required if submitting with missing grades)" className="w-96 rounded border border-gray-300 px-2 py-1 text-sm" />
                  <button type="submit" className="w-fit rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">Submit</button>
                </form>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
