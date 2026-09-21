import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock, FileEdit, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";

/**
 * The course-planning screen's two repeated shapes: the banner that says
 * where the plan stands, and one course inside it.
 *
 * Both used to be ad-hoc markup in page.tsx -- a bare `<ul>` of text with a
 * muted word floated to the right, which said the right things and looked
 * like nothing. Everything here is presentation over the same facts; no
 * caller passes a status this file invents.
 */

// ---------------------------------------------------------------------------
// Status banner
// ---------------------------------------------------------------------------

export type PlanState = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PARTIALLY_APPROVED";

const STATE_PRESENTATION: Record<PlanState, { tone: Tone; label: string; icon: ReactNode }> = {
  DRAFT: { tone: "neutral", label: "Draft", icon: <FileEdit className="h-5 w-5" aria-hidden="true" /> },
  SUBMITTED: { tone: "info", label: "Awaiting decision", icon: <Clock className="h-5 w-5" aria-hidden="true" /> },
  APPROVED: { tone: "success", label: "Approved", icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> },
  REJECTED: { tone: "danger", label: "Returned", icon: <XCircle className="h-5 w-5" aria-hidden="true" /> },
  PARTIALLY_APPROVED: {
    tone: "warning",
    label: "Partly approved",
    icon: <CircleDashed className="h-5 w-5" aria-hidden="true" />,
  },
};

// The banner's own surface per tone. Separate from Badge's map because this
// is a full-width panel: it takes the soft surface and the matching line,
// while the pill inside it keeps Badge's treatment.
const BANNER_TONE: Record<Tone, string> = {
  neutral: "border-line bg-surface-subtle",
  brand: "border-brand-line bg-brand-subtle",
  success: "border-success-line bg-success-surface",
  warning: "border-warning-line bg-warning-surface",
  danger: "border-danger-line bg-danger-surface",
  info: "border-info-line bg-info-surface",
};

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-surface text-fg-secondary",
  brand: "bg-surface text-brand-fg",
  success: "bg-surface text-success-fg",
  warning: "bg-surface text-warning-fg",
  danger: "bg-surface text-danger-fg",
  info: "bg-surface text-info-fg",
};

/**
 * Where the plan stands, as a panel rather than a sentence: the state, a
 * line of explanation, and the plan's own numbers as discrete facts.
 *
 * `facts` are label/value pairs the caller has already counted. Nothing is
 * shown that the caller did not pass, so a plan with no courses shows no
 * course count rather than a confident "0".
 */
export function PlanStatusBanner({
  state,
  headline,
  children,
  facts = [],
  actions,
}: {
  state: PlanState;
  headline: string;
  children?: ReactNode;
  facts?: { label: string; value: string }[];
  actions?: ReactNode;
}) {
  const { tone, label, icon } = STATE_PRESENTATION[state];

  return (
    <div className={cn("mb-6 rounded-2xl border p-5 sm:p-6", BANNER_TONE[tone])}>
      <div className="flex flex-wrap items-start gap-4">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm", ICON_TONE[tone])}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <h2 className="text-fg text-lg font-bold">{headline}</h2>
            <Badge tone={tone}>{label}</Badge>
          </div>
          {children && <div className="text-fg-secondary text-sm">{children}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {facts.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="border-line-subtle bg-surface/70 rounded-xl border px-3 py-2.5">
              <dt className="text-fg-muted text-[11px] font-semibold tracking-wide uppercase">{fact.label}</dt>
              <dd className="text-fg mt-0.5 text-sm font-bold">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One course in a plan
// ---------------------------------------------------------------------------

export type ItemState = "PENDING" | "APPROVED" | "REJECTED";

const ITEM_PRESENTATION: Record<ItemState, { tone: Tone; label: string }> = {
  PENDING: { tone: "info", label: "Awaiting decision" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "danger", label: "Turned down" },
};

/** One course in a student's plan, with where and when it actually meets. */
export interface PlanCourse {
  key: string;
  code: string;
  title: string;
  section: string;
  creditHours: number | string;
  /** Already reduced to the one slot a plan row shows: several meetings in
   *  the same room at the same hour are one line with their days collected.
   *  Empty when the offering has no meetings recorded. */
  days: string;
  daysFull: string;
  room: string;
  start: string;
  end: string;
  isRetake: boolean;
  state: ItemState;
  /** A rejection reason, or anything else true of this row. */
  note?: string;
  /** The caller's own control for this row -- remove, or a lock. */
  action?: ReactNode;
}

/**
 * A student's plan as a timetable rather than a list of names.
 *
 * It used to be one stacked card per course carrying the code, the title
 * and "Section 1 \u00b7 3 Cr/Hrs" -- which is most of what a student needs
 * EXCEPT the two things they open this page to check: which room, and at
 * what time. Those live on the offering and were simply never shown here,
 * though the Registrar has seen them on the review screen all along.
 *
 * Same columns, in the same order, dropping away at the same widths as the
 * admin review table, so the student and the Registrar are reading one
 * document rather than two designs of it.
 */
export function PlanCourseTable({ courses, actionHeader }: { courses: PlanCourse[]; actionHeader?: string }) {
  const showAction = courses.some((c) => c.action);

  return (
    <Table>
      <Thead>
        <tr>
          <Th className="whitespace-nowrap">Code</Th>
          <Th>Course Title</Th>
          <Th className="hidden whitespace-nowrap sm:table-cell">Sec</Th>
          <Th className="hidden whitespace-nowrap sm:table-cell">Cr/Hrs</Th>
          <Th className="hidden whitespace-nowrap md:table-cell">Room</Th>
          <Th className="hidden whitespace-nowrap sm:table-cell">Day</Th>
          <Th className="hidden whitespace-nowrap lg:table-cell">Start</Th>
          <Th className="hidden whitespace-nowrap lg:table-cell">End</Th>
          <Th className="whitespace-nowrap">Status</Th>
          {showAction && <Th className="text-right">{actionHeader ?? "Action"}</Th>}
        </tr>
      </Thead>
      <tbody>
        {courses.map((c) => {
          const { tone, label } = ITEM_PRESENTATION[c.state];
          return (
            <Tr key={c.key}>
              <Td className="text-brand-fg font-mono text-xs font-bold whitespace-nowrap">{c.code}</Td>
              <Td className="text-fg font-medium">
                {c.title}
                {c.isRetake && <span className="text-fg-muted ml-1.5 text-xs font-normal">(retake)</span>}
                {c.note && <span className="text-fg-secondary mt-0.5 block text-xs font-normal">{c.note}</span>}
                {/* Every column that drops away above is repeated here, so
                    a phone answers "which section, where and when" from the
                    row itself rather than from a sideways scroll. Below sm
                    the table is down to code, course, status and the
                    control -- which is what actually fits. */}
                <span className="text-fg-muted mt-0.5 block text-xs font-normal sm:hidden">
                  {[
                    c.section ? `Section ${c.section}` : null,
                    `${c.creditHours} Cr/Hrs`,
                    c.days || null,
                    c.start ? `${c.start}\u2013${c.end}` : null,
                    c.room || null,
                  ]
                    .filter(Boolean)
                    .join(" \u00b7 ")}
                </span>
              </Td>
              <Td className="hidden whitespace-nowrap sm:table-cell">{c.section || "\u2014"}</Td>
              <Td className="hidden whitespace-nowrap sm:table-cell">{c.creditHours}</Td>
              <Td className="text-fg-secondary hidden whitespace-nowrap md:table-cell">{c.room || "\u2014"}</Td>
              <Td className="hidden whitespace-nowrap sm:table-cell" title={c.daysFull || undefined}>
                {c.days || "\u2014"}
              </Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{c.start || "\u2014"}</Td>
              <Td className="hidden whitespace-nowrap lg:table-cell">{c.end || "\u2014"}</Td>
              <Td className="whitespace-nowrap">
                <Badge tone={tone}>{label}</Badge>
              </Td>
              {showAction && <Td className="text-right">{c.action}</Td>}
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** The empty state for a plan with no courses in it. */
export function PlanEmpty({ children }: { children: ReactNode }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardBody className="py-10 text-center">
        <span className="bg-brand-subtle text-brand-fg mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
          <CircleDashed className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="text-fg-secondary text-sm">{children}</p>
      </CardBody>
    </Card>
  );
}
