import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetings, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { getMyPlan, getPlanItems, getRegistrationsForStudent } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { startPlanAction, addPlanItemAction, removePlanItemAction, submitPlanAction, revisePlanAction, deleteDraftPlanAction } from "./actions";

export const metadata: Metadata = { title: "Course planning" };

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * S-07/S-08 (plan Section 20.3/20.4, Stage 9), combined into one page --
 * the same screen shows the build UI while DRAFT/REJECTED and the
 * read-only status view while SUBMITTED/APPROVED, matching how the
 * rejection path returns the student to the SAME row rather than a
 * separate "history" view (Section 14.2's "editable until submitted, then
 * again if rejected").
 */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  if (actor.role !== "STUDENT") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const { error } = await searchParams;

  const [semesters, academicYears] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany()]),
  );
  const openSemester = semesters.find((s) => s.state === "REGISTRATION");
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };

  if (!openSemester) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 outline-none">
        <PageHeader title="Course planning" />
        <p className="text-sm text-fg-muted">Course planning is not currently open.</p>
      </main>
    );
  }

  const semesterId = openSemester.id;
  const plan = await getMyPlan(actor, semesterId);
  const items = plan ? await getPlanItems(actor, plan.id) : [];
  const offerings = await getOfferingsForSemester(actor, semesterId);
  const courses = await asUser(actor.userId, (tx) =>
    tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true) }),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringFor = (offeringId: string) => offerings.find((o) => o.id === offeringId);
  const meetingsByOffering = new Map<string, Awaited<ReturnType<typeof getOfferingMeetings>>>();
  for (const o of offerings) {
    meetingsByOffering.set(o.id, await getOfferingMeetings(actor, o.id));
  }
  const plannedOfferingIds = new Set(items.map((i) => i.offeringId));
  const totalCredits = items.reduce((sum, i) => sum + (offeringFor(i.offeringId)?.frozenCreditHours ?? 0), 0);

  const registrations =
    plan?.status === "APPROVED" || plan?.status === "PARTIALLY_APPROVED"
      ? await getRegistrationsForStudent(actor, actor.userId, semesterId)
      : [];

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Course planning" description={yearLabel(semesterId)} />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {!plan && (
        <form action={startPlanAction}>
          <input type="hidden" name="semesterId" value={semesterId} />
          <Button type="submit">Start building your plan</Button>
        </form>
      )}

      {plan && (plan.status === "DRAFT" || plan.status === "REJECTED") && (
        <>
          {plan.status === "REJECTED" && (
            <Card className="mb-6 border-danger-line bg-danger-surface">
              <CardBody>
                <CardTitle className="mb-1 text-danger-fg">Rejected</CardTitle>
                <p className="mb-3 text-sm text-danger-fg">{plan.rejectionReason}</p>
                <form action={revisePlanAction}>
                  <input type="hidden" name="semesterId" value={semesterId} />
                  <input type="hidden" name="planId" value={plan.id} />
                  <Button type="submit" variant="secondary">
                    Revise
                  </Button>
                </form>
              </CardBody>
            </Card>
          )}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Your plan -- {totalCredits} credit hours</CardTitle>
            </CardHeader>
            <CardBody>
              {items.length === 0 && <p className="mb-3 text-sm text-fg-muted">No courses added yet.</p>}
              <ul className="mb-4 flex flex-col gap-2">
                {items.map((i) => {
                  const c = courseFor(i.courseId);
                  const o = offeringFor(i.offeringId);
                  return (
                    <li key={i.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                      <span>
                        {c ? `${c.code} — ${c.title}` : i.courseId} (Section {o?.section}){i.isRetake && " — retake"}
                      </span>
                      <form action={removePlanItemAction}>
                        <input type="hidden" name="semesterId" value={semesterId} />
                        <input type="hidden" name="planItemId" value={i.id} />
                        <button type="submit" className="text-xs font-medium text-danger-fg hover:underline">
                          Remove
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center gap-3">
                <form action={submitPlanAction}>
                  <input type="hidden" name="semesterId" value={semesterId} />
                  <input type="hidden" name="planId" value={plan.id} />
                  <Button type="submit">Submit</Button>
                </form>
                {plan.status === "DRAFT" && (
                  <form action={deleteDraftPlanAction}>
                    <input type="hidden" name="semesterId" value={semesterId} />
                    <input type="hidden" name="planId" value={plan.id} />
                    <button type="submit" className="text-xs font-medium text-danger-fg hover:underline">
                      Delete plan
                    </button>
                  </form>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Available offerings</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-3">
                {offerings.map((o) => {
                  const c = courseFor(o.courseId);
                  const meetings = meetingsByOffering.get(o.id) ?? [];
                  const already = plannedOfferingIds.has(o.id);
                  return (
                    <div key={o.id} className="rounded-md border border-line p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium text-fg">
                          {c ? `${c.code} — ${c.title}` : o.courseId} (Section {o.section})
                        </span>
                        <span className="text-xs text-fg-muted">{o.frozenCreditHours}cr</span>
                      </div>
                      <p className="mb-2 text-xs text-fg-muted">
                        {meetings.map((m) => `${DAY_NAMES[m.dayOfWeek]} ${m.startTime}-${m.endTime}${m.room ? ` (${m.room})` : ""}`).join(", ")}
                        {o.instructorName ? ` — ${o.instructorName}` : ""}
                      </p>
                      {already ? (
                        <span className="text-xs text-fg-subtle">Already in your plan</span>
                      ) : (
                        <form action={addPlanItemAction}>
                          <input type="hidden" name="semesterId" value={semesterId} />
                          <input type="hidden" name="planId" value={plan.id} />
                          <input type="hidden" name="offeringId" value={o.id} />
                          <button type="submit" className="text-xs font-medium text-brand-fg hover:underline">
                            Add
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {plan && plan.status === "SUBMITTED" && (
        <Card>
          <CardBody>
            <CardTitle className="mb-2">Submitted -- awaiting a decision</CardTitle>
            <p className="mb-3 text-sm text-fg-muted">
              {totalCredits} credit hours, submitted {plan.submittedAt?.toISOString().slice(0, 10)}.
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((i) => {
                const c = courseFor(i.courseId);
                return (
                  <li key={i.id} className="flex items-center justify-between">
                    <span>{c ? `${c.code} — ${c.title}` : i.courseId}</span>
                    <span className="text-xs text-fg-muted">
                      {i.status === "PENDING" ? "Awaiting decision" : i.status === "APPROVED" ? "Approved" : "Rejected"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      {plan && plan.status === "APPROVED" && (
        <Card className="border-success-line bg-success-surface">
          <CardBody>
            <CardTitle className="mb-2 text-success-fg">Approved</CardTitle>
            <p className="mb-3 text-sm text-success-fg">{totalCredits} credit hours registered.</p>
            <ul className="flex flex-col gap-1 text-sm text-success-fg">
              {registrations.filter((r) => r.status === "REGISTERED").map((r) => {
                const o = offeringFor(r.offeringId);
                const c = o ? courseFor(o.courseId) : undefined;
                return (
                  <li key={r.id}>
                    {c ? `${c.code} — ${c.title}` : r.offeringId}
                    {r.isRetake && " — retake"}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      {plan && plan.status === "PARTIALLY_APPROVED" && (
        <Card className="border-warning-line bg-warning-surface">
          <CardBody>
            <CardTitle className="mb-2 text-warning-fg">Partially approved</CardTitle>
            <p className="mb-3 text-sm text-warning-fg">Some courses were approved and registered; others were rejected.</p>
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((i) => {
                const c = courseFor(i.courseId);
                return (
                  <li key={i.id} className="flex items-center justify-between">
                    <span className="text-warning-fg">{c ? `${c.code} — ${c.title}` : i.courseId}</span>
                    {i.status === "APPROVED" ? (
                      <span className="text-xs font-medium text-success-fg">Approved</span>
                    ) : (
                      <span className="text-xs font-medium text-danger-fg">Rejected{i.rejectionReason ? `: ${i.rejectionReason}` : ""}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </main>
  );
}
