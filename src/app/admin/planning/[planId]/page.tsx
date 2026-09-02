import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsByIds } from "@/lib/offerings/offerings";
import { getPlan, getPlanItems } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const plan = await getPlan(actor, planId);
  if (!plan) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <p className="text-sm text-neutral-500">Plan not found.</p>
      </main>
    );
  }

  const items = await getPlanItems(actor, planId);
  const offeringIds = [...new Set(items.map((i) => i.offeringId))];
  const [student, offerings, courses, semester] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.student.findFirst({ where: (s, { eq }) => eq(s.id, plan.studentId) }),
      getOfferingsByIds(actor, offeringIds),
      tx.query.course.findMany(),
      tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, plan.semesterId) }),
    ]),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringFor = (offeringId: string) => offerings.find((o) => o.id === offeringId);
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, offeringIds);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title={student ? `${student.studentNumber} — ${student.firstName} ${student.lastName}` : plan.studentId}
        description={
          <>
            {semester?.name ?? plan.semesterId} — status <Badge tone="brand">{plan.status}</Badge> — {plan.totalCredits} credit hours
          </>
        }
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {plan.status === "REJECTED" && plan.rejectionReason && (
        <Alert tone="danger" className="mb-4">
          Previously rejected: {plan.rejectionReason}
        </Alert>
      )}

      <Card className="mb-6">
        <CardBody>
          <h2 className="mb-3 font-medium text-neutral-900">Items</h2>
          <div className="flex flex-col gap-3">
            {items.map((i) => {
              const c = courseFor(i.courseId);
              const o = offeringFor(i.offeringId);
              const meetings = o ? meetingsByOffering.get(o.id) ?? [] : [];
              return (
                <div key={i.id} className="rounded-md border border-neutral-200 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-neutral-900">
                      {c ? `${c.code} — ${c.title}` : i.courseId} (Section {o?.section})
                    </span>
                    <span className="text-xs text-neutral-500">
                      {o?.frozenCreditHours}cr{i.isRetake && " — retake"}
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-neutral-500">
                    {meetings.map((m) => `${DAY_NAMES[m.dayOfWeek]} ${m.startTime}-${m.endTime}`).join(", ")}
                  </p>
                  {i.prereqOverrideReason ? (
                    <p className="text-xs text-warning-700">Prerequisite overridden: {i.prereqOverrideReason}</p>
                  ) : (
                    plan.status !== "APPROVED" && (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">Override a failed prerequisite</summary>
                        <form action={overridePrerequisiteAction} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="planId" value={planId} />
                          <input type="hidden" name="planItemId" value={i.id} />
                          <input name="reason" required placeholder="Reason" className="w-64 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                          <Button type="submit" variant="secondary" size="sm">
                            Override
                          </Button>
                        </form>
                      </details>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {plan.status === "SUBMITTED" && (
        <section className="flex flex-wrap items-start gap-4">
          <form action={approvePlanAction}>
            <input type="hidden" name="planId" value={planId} />
            <Button type="submit">Approve</Button>
          </form>
          <form action={rejectPlanAction} className="flex items-end gap-2">
            <input type="hidden" name="planId" value={planId} />
            <input name="reason" required placeholder="Reason for rejection" className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            <Button type="submit" variant="danger">
              Reject
            </Button>
          </form>
        </section>
      )}
    </main>
  );
}
