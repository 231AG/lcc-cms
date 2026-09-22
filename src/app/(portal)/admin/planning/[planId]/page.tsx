import Link from "next/link";
import { AlertTriangle, Check, CalendarClock, Printer, ShieldAlert, Trash2, X } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { fullName } from "@/lib/students/name";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsByIds } from "@/lib/offerings/offerings";
import { getPlan, getPlanItems, getPlanValidation } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Input, Label } from "@/components/ui/Form";
import { SubmitButton, SubmitIconButton } from "@/components/ui/SubmitButton";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { TableCard } from "@/components/ui/TableCard";
import { expandDays, formatDays } from "@/lib/offerings/offeringRows";
import {
  approvePlanAction,
  approvePlanItemAction,
  overridePrerequisiteAction,
  overrideScheduleConflictAction,
  rejectPlanAction,
  rejectPlanItemAction,
  deletePlanAction,
} from "../actions";

/** Every icon control carries the same treatment: a tooltip on hover, and
 *  an accessible name that says the same thing for anyone not using a
 *  mouse. Matches the Students and Offerings tables. */
/** The two overrides and any other secondary glyph on a row: quiet until
 *  you go near it. */
const iconAction =
  "inline-flex rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The one control here that destroys something, so the only one that is
 *  red at rest rather than on hover. It fills on hover like the decide
 *  buttons do, so the thing about to happen stops being a suggestion. */
const deleteAction =
  "inline-flex cursor-pointer list-none rounded-md border border-danger-line bg-danger-surface p-1.5 " +
  "text-danger-fg transition-colors hover:border-danger-solid hover:bg-danger-solid hover:text-on-solid " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The decide buttons.
 *
 * These were bare grey glyphs that looked identical to the two override
 * icons beside them -- nothing said which one registered a student for a
 * course and which one opened a note. They are tinted, labelled and
 * bordered now: green approve, red reject, each with its word next to the
 * mark, so the consequential pair reads as a pair and the overrides stay
 * quiet behind them.
 */
const decideAction =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring " +
  "active:translate-y-px";

//  The hover state fills: the soft tint becomes the solid colour and the
//  label flips to white, so the button you are about to press stops being
//  a suggestion. Only tokens that exist are used -- `cn` is a plain
//  joiner with no tailwind-merge, so an invented class name here would
//  silently do nothing at all.
const approveAction =
  `${decideAction} border-success-line bg-success-surface text-success-fg ` +
  "hover:border-success-solid hover:bg-success-solid hover:text-on-solid hover:shadow-sm";

const rejectAction =
  `${decideAction} border-danger-line bg-danger-surface text-danger-fg ` +
  "hover:border-danger-solid hover:bg-danger-solid hover:text-on-solid hover:shadow-sm";

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
  // What would stop this plan being approved, computed fresh. Shown here
  // because the review screen is where somebody decides -- until now a
  // clash only surfaced as an error message after Approve had already
  // failed, which is a poor way to learn what is wrong with something.
  const validation = await getPlanValidation(actor, planId);
  const scheduleIssues = [...validation.blocking, ...validation.warnings].filter((i) => i.code === "V6");
  const blockingScheduleIssues = validation.blocking.filter((i) => i.code === "V6");
  const otherBlocking = validation.blocking.filter((i) => i.code !== "V6");
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringFor = (offeringId: string) => offerings.find((o) => o.id === offeringId);
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, offeringIds);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader
        title={student ? `${student.studentNumber} — ${fullName(student)}` : plan.studentId}
        description={
          <>
            {semester?.name ?? plan.semesterId} — status <Badge tone={PLAN_STATUS_TONE[plan.status] ?? "neutral"}>{plan.status}</Badge> —{" "}
            {plan.totalCredits} Cr/Hrs
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

      {scheduleIssues.length > 0 && (
        <Alert tone={blockingScheduleIssues.length > 0 ? "danger" : "warning"} className="mb-4">
          <p className="font-medium">
            {blockingScheduleIssues.length > 0
              ? "This plan has a timetable clash that must be accepted before it can be approved."
              : "This plan has a timetable clash, already accepted."}
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {scheduleIssues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          {blockingScheduleIssues.length > 0 && (
            <p className="mt-2 text-xs">
              Use the clock icon on either clashing course below to accept the overlap, or reject the plan.
            </p>
          )}
        </Alert>
      )}

      {otherBlocking.length > 0 && (
        <Alert tone="danger" className="mb-4">
          <p className="font-medium">This plan cannot be approved yet:</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {otherBlocking.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <TableCard
        title="Planned courses"
        count={items.length}
        countLabel="course"
        id="planned-courses"
        actions={
          <div className="flex items-center gap-1">
            <Link
              href={`/admin/planning/${plan.id}/control-sheet`}
              className={iconAction}
              title="Print the Control Sheet"
              aria-label="Print the Control Sheet"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
            </Link>
            {/* Red, because it is the only control on this page that
                destroys something. The others change a status; this one
                leaves nothing behind. */}
            <details className="relative">
              <summary
                className={deleteAction}
                title="Delete this plan"
                aria-label="Delete this plan"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </summary>
              <div className="border-danger-line bg-surface absolute right-0 z-10 mt-2 w-64 rounded-xl border p-3 shadow-lg">
                <p className="text-danger-fg flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Are you sure you want to delete?
                </p>
                <form action={deletePlanAction} className="mt-3">
                  <input type="hidden" name="planId" value={plan.id} />
                  <SubmitButton variant="danger" size="sm" className="w-full" pendingLabel="Deleting…">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Yes, delete this plan
                  </SubmitButton>
                </form>
              </div>
            </details>
          </div>
        }
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
                    {i.scheduleOverrideReason && (
                      <p className="mt-1 text-xs text-warning-fg">Timetable clash accepted: {i.scheduleOverrideReason}</p>
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
                            <SubmitIconButton
                              title={`Approve ${c?.code ?? "this course"}`}
                              aria-label={`Approve ${c?.code ?? "this course"}`}
                              className={approveAction}
                              icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                            >
                              Approve
                            </SubmitIconButton>
                          </form>
                          {/* Reject needs a reason -- the database refuses a
                              rejection without one -- so the icon opens the
                              reason rather than submitting on its own. */}
                          <details className="relative">
                            <summary
                              title={`Reject ${c?.code ?? "this course"}`}
                              aria-label={`Reject ${c?.code ?? "this course"}`}
                              className={`${rejectAction} cursor-pointer list-none`}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                              Reject
                            </summary>
                            <form
                              action={rejectPlanItemAction}
                              className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left shadow-lg"
                            >
                              <input type="hidden" name="planId" value={planId} />
                              <input type="hidden" name="planItemId" value={i.id} />
                              <Input name="reason" required placeholder="Reason for rejection" className="py-1 text-xs" />
                              <SubmitButton variant="danger" size="sm" pendingLabel="Rejecting…">
                                Reject course
                              </SubmitButton>
                            </form>
                          </details>
                        </>
                      )}
                      {/* Offered only while this course is actually in an
                          un-accepted clash -- an icon that does nothing on
                          every other row is noise. */}
                      {i.status === "PENDING" &&
                        !i.scheduleOverrideReason &&
                        blockingScheduleIssues.some((issue) => issue.courseCode === (c?.code ?? "")) && (
                          <details className="relative">
                            <summary
                              title={`Accept the timetable clash on ${c?.code ?? "this course"}`}
                              aria-label={`Accept the timetable clash on ${c?.code ?? "this course"}`}
                              className={`${iconAction} list-none`}
                            >
                              <CalendarClock className="h-4 w-4" aria-hidden="true" />
                            </summary>
                            <form
                              action={overrideScheduleConflictAction}
                              className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left shadow-lg"
                            >
                              <input type="hidden" name="planId" value={planId} />
                              <input type="hidden" name="planItemId" value={i.id} />
                              <Input name="reason" required placeholder="Why is the overlap acceptable?" className="py-1 text-xs" />
                              <SubmitButton variant="secondary" size="sm" pendingLabel="Accepting…">
                                Accept clash
                              </SubmitButton>
                            </form>
                          </details>
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
                            <SubmitButton variant="secondary" size="sm" pendingLabel="Overriding…">
                              Override prerequisite
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                      {!decidable && i.status !== "PENDING" && (
                        <span className="text-fg-muted text-xs">Decided</span>
                      )}
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
          <div className="border-line-subtle bg-surface-subtle border-t px-4 py-4 sm:px-5">
            {/* Approve on the left, reject on the right, with the reason
                attached to the button that needs it. The two used to sit
                side by side in one wrapping row, which put the reason box
                between them and let "Reject all" wrap underneath its own
                input. */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <form action={approvePlanAction}>
                <input type="hidden" name="planId" value={planId} />
                <SubmitButton pendingLabel="Approving…">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Approve all
                </SubmitButton>
              </form>
              <form action={rejectPlanAction} className="flex items-end gap-2">
                <input type="hidden" name="planId" value={planId} />
                <div>
                  <Label htmlFor="bulk-reason" className="text-xs">
                    Reason
                  </Label>
                  <Input id="bulk-reason" name="reason" required placeholder="Why the whole plan is turned down" className="w-56 sm:w-72" />
                </div>
                <SubmitButton variant="danger" className="shrink-0" pendingLabel="Rejecting…">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Reject all
                </SubmitButton>
              </form>
            </div>
            <p className="text-fg-muted mt-3 text-xs">
              Both apply to every course still pending above; courses already decided are left alone.
            </p>
          </div>
        )}
      </TableCard>

    </main>
  );
}
