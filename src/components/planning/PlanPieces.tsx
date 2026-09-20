import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock, FileEdit, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
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

const ACCENT: Record<ItemState, string> = {
  PENDING: "before:bg-info-line",
  APPROVED: "before:bg-success-line",
  REJECTED: "before:bg-danger-line",
};

/**
 * One planned course: its code as a monospace chip, its title, whatever
 * meta the caller has (section, credit hours, retake), the decision as a
 * pill, and the caller's own control on the right.
 *
 * The coloured edge is `::before` rather than a border-left, so it hugs the
 * rounded corner instead of squaring it off.
 */
export function PlanCourseRow({
  code,
  title,
  meta = [],
  state,
  note,
  action,
}: {
  code: string;
  title: string;
  meta?: string[];
  state: ItemState;
  note?: string;
  action?: ReactNode;
}) {
  const { tone, label } = ITEM_PRESENTATION[state];

  return (
    <li
      className={cn(
        "border-line bg-surface relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-xl border py-3 pr-4 pl-5",
        "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:content-['']",
        ACCENT[state],
      )}
    >
      <span className="bg-brand-subtle text-brand-fg shrink-0 rounded-md px-2 py-1 font-mono text-xs font-bold">{code}</span>

      <span className="min-w-0 flex-1">
        <span className="text-fg block text-sm font-semibold">{title}</span>
        {meta.length > 0 && <span className="text-fg-muted mt-0.5 block text-xs">{meta.join(" · ")}</span>}
        {note && <span className="text-fg-secondary mt-1 block text-xs">{note}</span>}
      </span>

      <Badge tone={tone}>{label}</Badge>
      {action && <span className="shrink-0">{action}</span>}
    </li>
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
