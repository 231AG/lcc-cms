import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetings, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { getPlan, getPlanItems } from "@/lib/planning/planning";
import { approvePlanAction, overridePrerequisiteAction, rejectPlanAction } from "../actions";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A-11's detail half: one plan, its items, and the Admin's decision.
 * Works at any plan status -- a DRAFT/REJECTED plan can still receive a
 * prerequisite override (Section 14.5), a SUBMITTED plan can be approved
 * or rejected, an APPROVED plan is shown read-only.
 */
export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { planId } = await params;
  const { error } = await searchParams;

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

  const plan = await getPlan(actor, planId);
  if (!plan) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="text-sm text-gray-500">Plan not found.</p>
      </main>
    );
  }

  const items = await getPlanItems(actor, planId);
  const [student, offerings, courses, semester] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.student.findFirst({ where: (s, { eq }) => eq(s.id, plan.studentId) }),
      getOfferingsForSemester(actor, plan.semesterId),
      tx.query.course.findMany(),
      tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, plan.semesterId) }),
    ]),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringFor = (offeringId: string) => offerings.find((o) => o.id === offeringId);
  const meetingsByOffering = new Map<string, Awaited<ReturnType<typeof getOfferingMeetings>>>();
  for (const o of offerings) {
    meetingsByOffering.set(o.id, await getOfferingMeetings(actor, o.id));
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">
        {student ? `${student.studentNumber} — ${student.firstName} ${student.lastName}` : plan.studentId}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        {semester?.name ?? plan.semesterId} — status <span className="font-medium">{plan.status}</span> — {plan.totalCredits} credit hours
      </p>

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {plan.status === "REJECTED" && plan.rejectionReason && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Previously rejected: {plan.rejectionReason}
        </p>
      )}

      <section className="mb-6 rounded border border-gray-200 p-4">
        <h2 className="mb-3 font-medium">Items</h2>
        <div className="flex flex-col gap-3">
          {items.map((i) => {
            const c = courseFor(i.courseId);
            const o = offeringFor(i.offeringId);
            const meetings = o ? meetingsByOffering.get(o.id) ?? [] : [];
            return (
              <div key={i.id} className="rounded border border-gray-200 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">
                    {c ? `${c.code} — ${c.title}` : i.courseId} (Section {o?.section})
                  </span>
                  <span className="text-xs text-gray-500">{o?.frozenCreditHours}cr{i.isRetake && " — retake"}</span>
                </div>
                <p className="mb-2 text-xs text-gray-500">
                  {meetings.map((m) => `${DAY_NAMES[m.dayOfWeek]} ${m.startTime}-${m.endTime}`).join(", ")}
                </p>
                {i.prereqOverrideReason ? (
                  <p className="text-xs text-amber-700">Prerequisite overridden: {i.prereqOverrideReason}</p>
                ) : (
                  plan.status !== "APPROVED" && (
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-700 underline">Override a failed prerequisite</summary>
                      <form action={overridePrerequisiteAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="planId" value={planId} />
                        <input type="hidden" name="planItemId" value={i.id} />
                        <input name="reason" required placeholder="Reason" className="w-64 rounded border border-gray-300 px-2 py-1 text-xs" />
                        <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium">Override</button>
                      </form>
                    </details>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      {plan.status === "SUBMITTED" && (
        <section className="flex flex-wrap items-start gap-4">
          <form action={approvePlanAction}>
            <input type="hidden" name="planId" value={planId} />
            <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">Approve</button>
          </form>
          <form action={rejectPlanAction} className="flex items-end gap-2">
            <input type="hidden" name="planId" value={planId} />
            <input name="reason" required placeholder="Reason for rejection" className="w-64 rounded border border-gray-300 px-2 py-1 text-sm" />
            <button type="submit" className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700">Reject</button>
          </form>
        </section>
      )}
    </main>
  );
}
