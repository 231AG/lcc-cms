import { Check, ShieldAlert, X } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { fullName } from "@/lib/students/name";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsByIds } from "@/lib/offerings/offerings";
import { getPlan, getPlanItems } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { TableCard } from "@/components/ui/TableCard";
import { expandDays, formatDays } from "@/lib/offerings/offeringRows";
import {
  approvePlanAction,
  approvePlanItemAction,
  overridePrerequisiteAction,
  rejectPlanAction,
  rejectPlanItemAction,
} from "../actions";

/** Every icon control carries the same treatment: a tooltip on hover, and
 *  an accessible name that says the same thing for anyone not using a
 *  mouse. Matches the Students and Offerings tables. */
const iconAction =
  "inline-flex rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const PLAN_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "brand",
  APPROVED: "success",
  REJECTED: "danger",
  PARTIALLY_APPROVED: "warning",
};

const ITEM_STATUS_TONE: Record<string, Tone> = {
  PENDING: "neutral",
  APPROVED: "success",
  REJECTED: "danger",
};

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
        <p className="text-sm text-fg-muted">Plan not found.</p>
      </main>
    );
  }

  const items = await getPlanItems(actor, planId);
  const offeringIds = [...new Set(items.map((i) => i.offeringId))];
  const [student, offerings, courses, semester, enteredByUser] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.student.findFirst({ where: (s, { eq }) => eq(s.id, plan.studentId) }),
      getOfferingsByIds(actor, offeringIds),
      tx.query.course.findMany(),
      tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, plan.semesterId) }),
      plan.enteredBy
        ? tx.query.appUser.findFirst({ where: (u, { eq }) => eq(u.id, plan.enteredBy!) })
        : Promise.resolve(undefined),
    ]),
  );
  const enteredByName = enteredByUser?.displayName;
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringFor = (offeringId: string) => offerings.find((o) => o.id === offeringId);
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, offeringIds);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title={student ? `${student.studentNumber} — ${fullName(student)}` : plan.studentId}
        description={
          <>
            {semester?.name ?? plan.semesterId} — status <Badge tone={PLAN_STATUS_TONE[plan.status] ?? "neutral"}>{plan.status}</Badge> —{" "}
            {plan.totalCredits} credit hours
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

      {/* DEV-20: this plan was entered by the office, not submitted by the
          student. Stated plainly at the point of decision -- the reviewer
          may well be the same person who entered it, and the accepted
          trade-off there (no forced second pair of eyes, because a
          one-person Admin office would otherwise be unable to use this at
          all) depends on the fact being visible rather than buried in the
          audit log. */}
      {plan.enteredBy && (
        <Alert tone="info" className="mb-4">
          Entered by {enteredByName ?? "an administrator"} on the student&rsquo;s behalf, not submitted by the student.
        </Alert>
      )}

      <TableCard
        title="Planned courses"
        count={items.length}
        countLabel="course"
        id="planned-courses"
      >
        <Table>
          <Thead>
            <tr>
              <Th className="whitespace-nowrap">Course Code</Th>
              <Th>Course Title</Th>
              <Th className="whitespace-nowrap">Sec</Th>
              <Th className="hidden whitespace-nowrap sm:table-cell">Cr/Hrs</Th>
              <Th className="hidden whitespace-nowrap md:table-cell">Room</Th>
              <Th className="whitespace-nowrap">Day</Th>
              <Th className="hidden whitespace-nowrap lg:table-cell">Start</Th>
              <Th className="hidden whitespace-nowrap lg:table-cell">End</Th>
              <Th className="whitespace-nowrap">Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </Thead>
          <tbody>
            {items.map((i) => {
              const c = courseFor(i.courseId);
              const o = offeringFor(i.offeringId);
              const meetings = o ? (meetingsByOffering.get(o.id) ?? []) : [];
              // The plan shows one row per course, so several meetings are
              // summarised into the slot a reader needs to see: the days,
              // and the room and time they share.
              const days = formatDays(meetings.map((m) => m.dayOfWeek));
              const first = meetings[0];
              const decidable = plan.status === "SUBMITTED" && i.status === "PENDING";
              return (
                <Tr key={i.id} className="align-top">
                  <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{c?.code ?? i.courseId}</Td>
                  <Td className="min-w-[12rem] font-medium text-fg">
                    {c?.title ?? "—"}
                    {i.isRetake && (
                      <Badge tone="warning" className="ml-2">
                        RETAKE
                      </Badge>
                    )}
                    {i.status === "REJECTED" && i.rejectionReason && (
                      <p className="mt-1 text-xs text-danger-fg">Rejected: {i.rejectionReason}</p>
                    )}
                    {i.prereqOverrideReason && (
                      <p className="mt-1 text-xs text-warning-fg">Prerequisite overridden: {i.prereqOverrideReason}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{o?.section ?? "—"}</Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{o?.frozenCreditHours ?? "—"}</Td>
                  <Td className="hidden whitespace-nowrap text-fg-secondary md:table-cell">{first?.room || "—"}</Td>
                  <Td className="whitespace-nowrap" title={expandDays(days)}>
                    {days || "—"}
                  </Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{first?.startTime?.slice(0, 5) ?? "—"}</Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{first?.endTime?.slice(0, 5) ?? "—"}</Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={ITEM_STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
                  </Td>
                  <Td className="px-2 sm:px-3">
                    <span className="flex items-center justify-end gap-1">
                      {decidable && (
                        <>
                          <form action={approvePlanItemAction}>
                            <input type="hidden" name="planId" value={planId} />
                            <input type="hidden" name="planItemId" value={i.id} />
                            <button
                              type="submit"
                              title={`Approve ${c?.code ?? "this course"}`}
                              aria-label={`Approve ${c?.code ?? "this course"}`}
                              className={iconAction}
                            >
                              <Check className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </form>
                          {/* Reject needs a reason -- the database refuses a
                              rejection without one -- so the icon opens the
                              reason rather than submitting on its own. */}
                          <details className="relative">
                            <summary
                              title={`Reject ${c?.code ?? "this course"}`}
                              aria-label={`Reject ${c?.code ?? "this course"}`}
                              className={`${iconAction} list-none`}
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </summary>
                            <form
                              action={rejectPlanItemAction}
                              className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left shadow-lg"
                            >
                              <input type="hidden" name="planId" value={planId} />
                              <input type="hidden" name="planItemId" value={i.id} />
                              <Input name="reason" required placeholder="Reason for rejection" className="py-1 text-xs" />
                              <Button type="submit" variant="danger" size="sm">
                                Reject course
                              </Button>
                            </form>
                          </details>
                        </>
                      )}
                      {i.status === "PENDING" && !i.prereqOverrideReason && (
                        <details className="relative">
                          <summary
                            title="Override a failed prerequisite"
                            aria-label="Override a failed prerequisite"
                            className={`${iconAction} list-none`}
                          >
                            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                          </summary>
                          <form
                            action={overridePrerequisiteAction}
                            className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left shadow-lg"
                          >
                            <input type="hidden" name="planId" value={planId} />
                            <input type="hidden" name="planItemId" value={i.id} />
                            <Input name="reason" required placeholder="Reason for override" className="py-1 text-xs" />
                            <Button type="submit" variant="secondary" size="sm">
                              Override prerequisite
                            </Button>
                          </form>
                        </details>
                      )}
                      {!decidable && i.status !== "PENDING" && <span className="text-xs text-fg-muted">Decided</span>}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>

        {/* At the bottom of the table, where a reviewer arrives after
            reading every row, rather than in a separate card below it. */}
        {plan.status === "SUBMITTED" && items.some((i) => i.status === "PENDING") && (
          <div className="flex flex-wrap items-start gap-4 border-t border-line-subtle px-4 py-4 sm:px-5">
            <form action={approvePlanAction}>
              <input type="hidden" name="planId" value={planId} />
              <Button type="submit">
                <Check className="h-4 w-4" aria-hidden="true" />
                Approve all
              </Button>
            </form>
            <form action={rejectPlanAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="planId" value={planId} />
              <Input name="reason" required placeholder="Reason for rejection" className="w-64" />
              <Button type="submit" variant="danger">
                <X className="h-4 w-4" aria-hidden="true" />
                Reject all
              </Button>
            </form>
            <p className="w-full text-xs text-fg-muted">
              Both apply to every course still pending above; courses already decided are left alone.
            </p>
          </div>
        )}
      </TableCard>

    </main>
  );
}
