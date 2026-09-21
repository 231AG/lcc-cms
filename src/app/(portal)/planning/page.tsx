import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/session";
import { isPlanningOpen, pickPlanningSemester, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsByIds, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { expandDays, formatDays, groupMeetingSlots } from "@/lib/offerings/offeringRows";
import { filterOfferings, pageSlice } from "@/lib/offerings/offeringSearch";
import { getMyPlan, getMyPlans, getPlanItems, getRegistrationsForStudent } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Select } from "@/components/ui/Form";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { ClipboardList, Lock, Send, Trash2 } from "lucide-react";
import { OfferingPicker } from "@/components/planning/OfferingPicker";
import { PlanCourseTable, PlanEmpty, PlanStatusBanner, type PlanCourse, type PlanState } from "@/components/planning/PlanPieces";
import {
  startPlanAction,
  addPlanItemAction,
  removePlanItemAction,
  submitPlanAction,
  deleteDraftPlanAction,
} from "./actions";

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

  const { error, q, page, semesterId: requestedSemesterId } = await searchParams;

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
  // The newest OPEN semester, not simply the first one the query returned:
  // nothing limits the College to one OPEN semester at a time, and an
  // unordered pick here could land on a different semester than the one
  // the dashboard's status line was describing.
  const openSemester = pickPlanningSemester(semesters);
  // Every semester this student has ever planned in, so a past plan stays
  // reachable after its semester closes -- one small query, and the reason
  // the picker below can offer anything other than the open semester.
  // getMyPlans, NOT getPlansForStudent: the latter is the Admin read and
  // asserts a permission no student has.
  const myPlans = await getMyPlans(actor);
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return semesterFullLabel(year, sem, semId);
  };

  // What the picker may offer: the semester planning is open in, plus any
  // the student already has a plan in. Nothing else -- a semester with
  // neither is a semester there is nothing to see or do in.
  const selectableSemesters = semesters
    .filter((s) => s.id === openSemester?.id || myPlans.some((p) => p.semesterId === s.id))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (selectableSemesters.length === 0) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 outline-none">
        <PageHeader title="Course planning" />
        <p className="text-sm text-fg-muted">Course planning is not currently open.</p>
      </main>
    );
  }

  // Defaults to the semester planning is actually open in, which is the one
  // a student almost always wants; an explicit ?semesterId wins, so a past
  // plan can still be opened. An unrecognised id falls back rather than
  // erroring.
  const semesterId =
    (requestedSemesterId && selectableSemesters.find((s) => s.id === requestedSemesterId)?.id) ??
    openSemester?.id ??
    selectableSemesters[0].id;
  const viewingSemester = selectableSemesters.find((s) => s.id === semesterId);
  const planningOpenHere = !!viewingSemester && isPlanningOpen(viewingSemester.state as SemesterState);
  const plan = await getMyPlan(actor, semesterId);
  const items = plan ? await getPlanItems(actor, plan.id) : [];
  // A partly-approved plan is still the student's to work on: the courses
  // that were refused are the reason they came back.
  // SUBMITTED is editable as of this change: a plan nobody has approved is
  // still the student's, and the first edit takes it out of the review
  // queue by itself (see reopenForEditing in planning.ts). APPROVED is the
  // only state that locks, because its courses are registered.
  const isEditable = planningOpenHere && (!plan || plan.status !== "APPROVED");
  const hasRegisteredItems = items.some((i) => i.status === "APPROVED");

  const registrations =
    plan?.status === "APPROVED" || plan?.status === "PARTIALLY_APPROVED"
      ? await getRegistrationsForStudent(actor, actor.userId, semesterId)
      : [];

  // The full semester catalogue is only needed while the plan is still
  // being built. Once it is submitted or decided, only the handful of
  // offerings the plan and its registrations actually reference matter.
  const availableOfferings = isEditable ? await getOfferingsForSemester(actor, semesterId) : [];
  // Anything the plan or its registrations point at that the catalogue does
  // not cover -- a cancelled offering, or any offering at all once the plan
  // is past editing.
  const catalogueIds = new Set(availableOfferings.map((o) => o.id));
  const referencedIds = [...new Set([...items.map((i) => i.offeringId), ...registrations.map((r) => r.offeringId)])].filter(
    (id) => !catalogueIds.has(id),
  );
  const referencedOfferings = referencedIds.length > 0 ? await getOfferingsByIds(actor, referencedIds) : [];
  const offeringById = new Map([...availableOfferings, ...referencedOfferings].map((o) => [o.id, o]));

  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const registeredRegistrations = registrations.filter((r) => r.status === "REGISTERED");
  const approvedCount = items.filter((i) => i.status === "APPROVED").length;
  const rejectedCount = items.filter((i) => i.status === "REJECTED").length;
  const pendingCount = items.filter((i) => i.status === "PENDING").length;
  // Where and when every course in this plan actually meets. One batched
  // query for the plan's own offerings, separate from the catalogue's --
  // the catalogue is paged and the plan is not, so they are different sets
  // and fetching either does not cover the other.
  const planOfferingIds = [...new Set([...items.map((i) => i.offeringId), ...registrations.map((r) => r.offeringId)])];
  const planMeetings = await getOfferingMeetingsForOfferings(actor, planOfferingIds);

  /** The room, days and times one plan row shows. A course meeting twice
   *  in the same room at the same hour is one slot with both days on it;
   *  anything past the first slot is left to the catalogue below, which
   *  has the room to list them all. */
  const scheduleFor = (offeringId: string) => {
    const slots = groupMeetingSlots(planMeetings.get(offeringId) ?? []);
    const first = slots[0];
    const days = first ? formatDays(first.days) : "";
    return { days, daysFull: expandDays(days), room: first?.room ?? "", start: first?.start ?? "", end: first?.end ?? "" };
  };

  /** One course's row props, so the editor and the read-only views cannot
   *  describe the same course differently. */
  const rowFor = (i: (typeof items)[number]): PlanCourse => {
    const c = courseFor(i.courseId);
    const o = offeringById.get(i.offeringId);
    return {
      key: i.id,
      code: c?.code ?? "\u2014",
      title: c?.title ?? i.courseId,
      section: o?.section ?? "",
      creditHours: o?.frozenCreditHours ?? "\u2014",
      ...scheduleFor(i.offeringId),
      isRetake: i.isRetake,
      state: i.status as "PENDING" | "APPROVED" | "REJECTED",
      note:
        i.status === "REJECTED" && i.rejectionReason
          ? i.rejectionReason
          : i.status === "APPROVED"
            ? "Registered \u2014 ask the Registrar to drop it."
            : undefined,
    };
  };
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
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader title="Course planning" description={yearLabel(semesterId)} />

      {/* Only shown when there is something to switch between. Submitting on
          change keeps this a plain form -- the same data-auto-submit hook
          the admin pickers use, and it still works without JavaScript. */}
      {selectableSemesters.length > 1 && (
        <form method="get" className="mb-4 flex items-end gap-2">
          <div>
            <Label htmlFor="semesterId" className="text-xs">
              Semester
            </Label>
            <Select id="semesterId" name="semesterId" defaultValue={semesterId} className="w-64" data-auto-submit="">
              {selectableSemesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {yearLabel(s.id)}
                  {s.id === openSemester?.id ? " — open for planning" : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="ghost" className="mb-px">
            Show
          </Button>
        </form>
      )}

      {!planningOpenHere && (
        <Alert tone="info" className="mb-4">
          Planning is closed for this semester. You can look at your plan, but not change it.
        </Alert>
      )}

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

      {plan && isEditable && (
        <>
          <PlanStatusBanner
            state={plan.status as PlanState}
            headline={
              plan.status === "SUBMITTED"
                ? "Your plan is with the Registrar"
                : plan.status === "REJECTED"
                  ? "Your plan was returned"
                  : plan.status === "PARTIALLY_APPROVED"
                    ? "Some courses were approved"
                    : items.length === 0
                      ? "Start building your plan"
                      : "Your plan is a draft"
            }
            facts={[
              { label: "Courses", value: String(items.length) },
              { label: "Cr/Hrs", value: String(totalCredits) },
              ...(approvedCount > 0 ? [{ label: "Registered", value: String(approvedCount) }] : []),
              ...(rejectedCount > 0 ? [{ label: "Turned down", value: String(rejectedCount) }] : []),
              ...(plan.status === "SUBMITTED" && plan.submittedAt
                ? [{ label: "Submitted", value: plan.submittedAt.toISOString().slice(0, 10) }]
                : []),
            ]}
          >
            {plan.status === "SUBMITTED" ? (
              // The change this screen exists to communicate: waiting is no
              // longer the same as frozen.
              <>
                {pendingCount === items.length
                  ? "Nobody has decided on it yet."
                  : "Some of it has been decided already."}{" "}
                You can still change it — editing takes it out of the queue, and you submit again when you are ready.
              </>
            ) : plan.status === "REJECTED" ? (
              <>
                {plan.rejectionReason ?? "Every course in this plan was turned down."} Change the courses below and submit again.
              </>
            ) : plan.status === "PARTIALLY_APPROVED" ? (
              <>The approved courses are registered and cannot be changed here. Replace the ones that were turned down and submit again.</>
            ) : items.length === 0 ? (
              <>Add courses from the catalogue below, then submit the plan for the Registrar to approve.</>
            ) : (
              <>Not submitted yet — add or remove courses, then submit when it is ready.</>
            )}
          </PlanStatusBanner>

          <Card className="mb-6">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}>Your plan</CardTitle>
              <span className="text-fg-muted text-sm">
                {items.length} {items.length === 1 ? "course" : "courses"} · {totalCredits} Cr/Hrs
              </span>
            </CardHeader>
            {items.length === 0 ? (
              <CardBody>
                <PlanEmpty>No courses yet. Pick them from the catalogue below.</PlanEmpty>
              </CardBody>
            ) : (
              <PlanCourseTable
                courses={items.map((i) => ({
                  ...rowFor(i),
                  action:
                    i.status === "APPROVED" ? (
                      <span className="text-fg-muted inline-flex items-center gap-1 text-xs font-medium">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Locked
                      </span>
                    ) : (
                      <form action={removePlanItemAction}>
                        {Object.entries(contextFields).map(([name, value]) => (
                          <input key={name} type="hidden" name={name} value={value} />
                        ))}
                        <input type="hidden" name="planItemId" value={i.id} />
                        <SubmitTextButton
                          pendingLabel="Removing…"
                          className="text-danger-fg inline-flex items-center gap-1 text-xs font-medium hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Remove
                        </SubmitTextButton>
                      </form>
                    ),
                }))}
              />
            )}

            {/* The submit row is its own strip under the table, divided
                from it by a rule, rather than sharing a box with the rows
                it acts on. */}
            <CardBody className="border-line-subtle border-t">
              <div className="flex flex-wrap items-center gap-3">
                <form action={submitPlanAction}>
                  {Object.entries(contextFields).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
                  <input type="hidden" name="planId" value={plan.id} />
                  <SubmitButton pendingLabel="Submitting…">
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {plan.status === "SUBMITTED" ? "Resubmit plan" : "Submit plan"}
                  </SubmitButton>
                </form>
                {plan.status === "SUBMITTED" && (
                  <p className="text-fg-muted text-xs">Already submitted — resubmit only if you change something.</p>
                )}
                {plan.status === "DRAFT" && !hasRegisteredItems && items.length > 0 && (
                  <form action={deleteDraftPlanAction} className="ml-auto">
                    <input type="hidden" name="semesterId" value={semesterId} />
                    <input type="hidden" name="planId" value={plan.id} />
                    <button type="submit" className="text-danger-fg text-xs font-medium hover:underline">
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

      {plan && plan.status === "APPROVED" && (
        <>
          <PlanStatusBanner
            state="APPROVED"
            headline="You are registered"
            facts={[
              { label: "Courses", value: String(registeredRegistrations.length) },
              { label: "Cr/Hrs", value: String(totalCredits) },
            ]}
          >
            Every course in this plan was approved. Changes now go through the Registrar.
          </PlanStatusBanner>

          <Card>
            <CardHeader>
              <CardTitle icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}>Registered courses</CardTitle>
            </CardHeader>
            {registeredRegistrations.length === 0 ? (
              <CardBody>
                <PlanEmpty>No registrations are recorded against this plan.</PlanEmpty>
              </CardBody>
            ) : (
              <PlanCourseTable
                courses={registeredRegistrations.map((r) => {
                  const o = offeringById.get(r.offeringId);
                  const c = o ? courseFor(o.courseId) : undefined;
                  return {
                    key: r.id,
                    code: c?.code ?? "\u2014",
                    title: c?.title ?? r.offeringId,
                    section: o?.section ?? "",
                    creditHours: o?.frozenCreditHours ?? "\u2014",
                    ...scheduleFor(r.offeringId),
                    isRetake: r.isRetake,
                    state: "APPROVED" as const,
                  };
                })}
              />
            )}
          </Card>
        </>
      )}

      {/* Planning has closed and the plan never reached APPROVED. Covers
          SUBMITTED as well as the two decided states: once the semester
          moves on, a plan still sitting in the queue is exactly as
          unchangeable as one that was turned down, and it used to render
          as a blank page because only the decided states had a branch. */}
      {plan && !planningOpenHere && plan.status !== "APPROVED" && (
        <>
          <PlanStatusBanner
            state={plan.status as PlanState}
            headline="Planning has closed for this semester"
            facts={[
              { label: "Courses", value: String(items.length) },
              { label: "Cr/Hrs", value: String(totalCredits) },
              ...(approvedCount > 0 ? [{ label: "Registered", value: String(approvedCount) }] : []),
              ...(rejectedCount > 0 ? [{ label: "Turned down", value: String(rejectedCount) }] : []),
            ]}
          >
            This plan can no longer be changed here. See the Registrar if you need to.
          </PlanStatusBanner>

          <Card>
            <CardHeader>
              <CardTitle icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}>Courses in this plan</CardTitle>
            </CardHeader>
            {items.length === 0 ? (
              <CardBody>
                <PlanEmpty>This plan has no courses in it. Please contact the Admin office.</PlanEmpty>
              </CardBody>
            ) : (
              <PlanCourseTable courses={items.map(rowFor)} />
            )}
          </Card>
        </>
      )}

    </main>
  );
}
