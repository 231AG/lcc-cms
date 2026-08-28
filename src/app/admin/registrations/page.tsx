import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getRegistrationsForOffering } from "@/lib/planning/planning";
import { dropRegistrationAction, registerDirectAction } from "./actions";

/**
 * A-17 (plan Section 20.4, Stage 9, DEC-14): registrations for one
 * offering -- direct registration and drop, both with a mandatory reason
 * since these are administrative acts that may legitimately deviate from
 * the normal plan-approval path (Section 14.4).
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ offeringId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { offeringId, error } = await searchParams;

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

  const [offerings, courses, students] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.status, "PUBLISHED") }),
      tx.query.course.findMany(),
      tx.query.student.findMany({ where: (s, { eq }) => eq(s.status, "ACTIVE") }),
    ]),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courseFor(o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };
  const studentLabel = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${s.firstName} ${s.lastName}` : studentId;
  };

  const registrations = offeringId ? await getRegistrationsForOffering(actor, offeringId) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Registrations</h1>

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="offeringId" className="mb-1 block text-xs font-medium">Offering</label>
          <select id="offeringId" name="offeringId" defaultValue={offeringId ?? ""} className="w-96 rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="">Select an offering…</option>
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>{offeringLabel(o)}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">Select</button>
      </form>

      {offeringId && (
        <>
          <section className="mb-6 rounded border border-gray-200 p-4">
            <h2 className="mb-3 font-medium">Register a student directly</h2>
            <form action={registerDirectAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="offeringId" value={offeringId} />
              <div>
                <label className="mb-1 block text-xs font-medium">Student</label>
                <select name="studentId" required className="w-64 rounded border border-gray-300 px-2 py-1 text-sm">
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.studentNumber} — {s.firstName} {s.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Reason</label>
                <input name="reason" required className="w-64 rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
              <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">Register</button>
            </form>
          </section>

          <section>
            <h2 className="mb-3 font-medium">Class list</h2>
            {registrations.length === 0 && <p className="text-sm text-gray-500">No registrations yet.</p>}
            <ul className="flex flex-col gap-2">
              {registrations.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
                  <span>
                    {studentLabel(r.studentId)} — {r.status}
                    {r.isRetake && " — retake"} — {r.source === "ADMIN_DIRECT" ? "direct" : "plan"}
                    {r.status === "DROPPED" && r.droppedReason && ` (${r.droppedReason})`}
                  </span>
                  {r.status === "REGISTERED" && (
                    <form action={dropRegistrationAction} className="flex items-center gap-2">
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <input type="hidden" name="registrationId" value={r.id} />
                      <input name="reason" required placeholder="Reason" className="w-40 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                      <button type="submit" className="text-xs text-red-700 underline">Drop</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
