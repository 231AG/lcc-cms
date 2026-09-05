import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/session";
import { isPlanningOpen, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsByIds, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { filterOfferings, pageSlice } from "@/lib/offerings/offeringSearch";
import { getMyPlan, getPlanItems, getRegistrationsForStudent } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { OfferingPicker } from "@/components/planning/OfferingPicker";
import { startPlanAction, addPlanItemAction, removePlanItemAction, submitPlanAction, revisePlanAction, deleteDraftPlanAction } from "./actions";

export const metadata: Metadata = { title: "Course planning" };

const PAGE_SIZE = 20;

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
  searchParams: Promise<{ semesterId?: string; error?: string; q?: string; page?: string }>;
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

  const { error, q, page } = await searchParams;

  // One round trip for all three reference lists rather than three
  // separate asUser() transactions -- each one is a full BEGIN / set role
  // / query / COMMIT against Supabase, so merging them is worth more here
  // than any single query optimisation.
  const [semesters, academicYears, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true) }),
    ]),
  );
  const openSemester = semesters.find((s) => isPlanningOpen(s.state as SemesterState));
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
  const isEditable = !plan || plan.status === "DRAFT" || plan.status === "REJECTED";

  const registrations =
    plan?.status === "APPROVED" || plan?.status === "PARTIALLY_APPROVED"
      ? await getRegistrationsForStudent(actor, actor.userId, semesterId)
      : [];

  // The full semester catalogue is only needed while the plan is still
  // being built. Once it is submitted or decided, only the handful of
  // offerings the plan and its registrations actually reference matter.
  const availableOfferings = isEditable ? await getOfferingsForSemester(actor, semesterId) : [];
  const referencedOfferings = isEditable
    ? []
    : await getOfferingsByIds(actor, [...new Set([...items.map((i) => i.offeringId), ...registrations.map((r) => r.offeringId)])]);
  const offeringById = new Map([...availableOfferings, ...referencedOfferings].map((o) => [o.id, o]));

  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const plannedOfferingIds = new Set(items.map((i) => i.offeringId));
  const totalCredits = items.reduce((sum, i) => sum + (offeringById.get(i.offeringId)?.frozenCreditHours ?? 0), 0);

  // Search and page the catalogue, then fetch meeting times for THIS
  // page's offerings only -- one batched query instead of one round trip
  // per offering (177 of them in the real 2026/2027 schedule, which made
  // this list effectively unusable before).
  const matching = filterOfferings(availableOfferings, courses, q);
  const { rows: pagedOfferings, page: pageNum } = pageSlice(matching, Number(page) || 1, PAGE_SIZE);
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, pagedOfferings.map((o) => o.id));

  const listParams = (overrides: Record<string, string | undefined> = {}) => {
    const merged: Record<string, string | undefined> = { q, page: String(pageNum), ...overrides };
    const params = new URLSearchParams({ semesterId });
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  };
  // Carried on every mutating form so an add/remove returns the student to
  // the same search and page rather than to the top of the catalogue.
  const contextFields: Record<string, string> = {
    semesterId,
    ...(q ? { q } : {}),
    ...(pageNum > 1 ? { page: String(pageNum) } : {}),
  };

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
          <SubmitButton pendingLabel="Starting…">Start building your plan</SubmitButton>
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
                  {Object.entries(contextFields).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
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
                  const o = offeringById.get(i.offeringId);
                  return (
                    <li key={i.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                      <span>
                        {c ? `${c.code} — ${c.title}` : i.courseId} (Section {o?.section}){i.isRetake && " — retake"}
                      </span>
                      <form action={removePlanItemAction}>
                        {Object.entries(contextFields).map(([name, value]) => (
                          <input key={name} type="hidden" name={name} value={value} />
                        ))}
                        <input type="hidden" name="planItemId" value={i.id} />
                        <SubmitTextButton pendingLabel="Removing…" className="text-xs font-medium text-danger-fg hover:underline">
                          Remove
                        </SubmitTextButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center gap-3">
                <form action={submitPlanAction}>
                  {Object.entries(contextFields).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
                  <input type="hidden" name="planId" value={plan.id} />
                  <SubmitButton pendingLabel="Submitting…">Submit</SubmitButton>
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

          <OfferingPicker
            offerings={pagedOfferings}
            courses={courses}
            meetingsByOffering={meetingsByOffering}
            plannedOfferingIds={plannedOfferingIds}
            q={q}
            page={pageNum}
            pageSize={PAGE_SIZE}
            totalMatching={matching.length}
            totalAvailable={availableOfferings.length}
            hrefForPage={(p) => `/planning?${listParams({ page: String(p) })}`}
            clearSearchHref={`/planning?${listParams({ q: undefined, page: undefined })}`}
            searchHiddenFields={{ semesterId }}
            addAction={addPlanItemAction}
            addHiddenFields={{ ...contextFields, planId: plan.id }}
          />
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
                const o = offeringById.get(r.offeringId);
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
