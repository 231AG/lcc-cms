import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getCorrectionQueue } from "@/lib/grades/grades";
import { decideCorrectionAction, requestCorrectionAction } from "./actions";

/**
 * X-03 (plan Section 24.11, Stage 10): grade corrections. Admin requests
 * (REQ-R06); Super Admin decides -- never the same actor (Section 15.5),
 * one role-conditional page matching the established pattern.
 */
export default async function GradeCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; offeringId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, offeringId, error } = await searchParams;

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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Grade corrections</h1>
      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {actor.role === "ADMIN" ? (
        <AdminRequestSection actor={actor} semesterId={semesterId} offeringId={offeringId} />
      ) : (
        <SuperAdminDecideSection actor={actor} />
      )}
    </main>
  );
}

async function AdminRequestSection({
  actor,
  semesterId,
  offeringId,
}: {
  actor: NonNullable<Awaited<ReturnType<typeof getCurrentActor>>>;
  semesterId?: string;
  offeringId?: string;
}) {
  const [semesters, academicYears, offerings, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      semesterId ? tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.semesterId, semesterId) }) : Promise.resolve([]),
      tx.query.course.findMany(),
    ]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courses.find((c) => c.id === o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };

  const publishedGrades = offeringId
    ? await asUser(actor.userId, async (tx) => {
        const regs = await tx.query.registration.findMany({ where: (r, { eq }) => eq(r.offeringId, offeringId) });
        const regIds = regs.map((r) => r.id);
        if (regIds.length === 0) return [];
        return tx.query.gradeRecord.findMany({
          where: (g, { and, inArray }) => and(inArray(g.registrationId, regIds), inArray(g.status, ["PUBLISHED", "LOCKED"])),
        });
      })
    : [];

  return (
    <>
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Semester</label>
          <select name="semesterId" defaultValue={semesterId ?? ""} className="w-72 rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="">Select a semester…</option>
            {semesters.map((s) => (
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
        <section>
          <h2 className="mb-3 font-medium">Published grades</h2>
          {publishedGrades.length === 0 && <p className="text-sm text-gray-500">No published grades in this class.</p>}
          <ul className="flex flex-col gap-3">
            {publishedGrades.map((g) => (
              <li key={g.id} className="rounded border border-gray-200 p-3 text-sm">
                <p className="mb-2">Current: {g.letter}{g.score ? ` (${g.score})` : ""}</p>
                <details>
                  <summary className="cursor-pointer text-xs text-blue-700 underline">Request a correction</summary>
                  <form action={requestCorrectionAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="gradeRecordId" value={g.id} />
                    <input name="newScore" type="number" min={0} max={100} step={0.1} placeholder="New score" className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="isIncomplete" /> Incomplete
                    </label>
                    <input name="reason" required placeholder="Reason" className="w-64 rounded border border-gray-300 px-2 py-1 text-xs" />
                    <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium">Request</button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function SuperAdminDecideSection({ actor }: { actor: NonNullable<Awaited<ReturnType<typeof getCurrentActor>>> }) {
  const queue = await getCorrectionQueue(actor);

  return (
    <section>
      <h2 className="mb-3 font-medium">Pending correction requests</h2>
      {queue.length === 0 && <p className="text-sm text-gray-500">No corrections awaiting a decision.</p>}
      <ul className="flex flex-col gap-3">
        {queue.map((r) => (
          <li key={r.id} className="rounded border border-gray-200 p-3 text-sm">
            <p className="mb-1">
              {r.oldLetter}{r.oldScore ? ` (${r.oldScore})` : ""} → {r.newLetter}{r.newScore ? ` (${r.newScore})` : ""}
            </p>
            <p className="mb-2 text-xs text-gray-500">Reason: {r.reason}</p>
            <div className="flex flex-wrap items-end gap-2">
              <form action={decideCorrectionAction}>
                <input type="hidden" name="correctionRequestId" value={r.id} />
                <input type="hidden" name="decision" value="APPROVE" />
                <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Approve</button>
              </form>
              <form action={decideCorrectionAction} className="flex items-end gap-2">
                <input type="hidden" name="correctionRequestId" value={r.id} />
                <input type="hidden" name="decision" value="REJECT" />
                <input name="note" placeholder="Note" className="w-48 rounded border border-gray-300 px-2 py-1 text-xs" />
                <button type="submit" className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700">Reject</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
