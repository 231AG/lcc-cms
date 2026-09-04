import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getSubmissionQueue } from "@/lib/grades/grades";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Grade submission review" };

/**
 * X-02 (plan Section 24.11, Stage 10): submissions awaiting a decision.
 * Super Admin only -- an Admin can submit a class but never approve or
 * reject one (Section 15.1).
 */
export default async function GradeReviewQueuePage() {
  const actor = await getCurrentActor();

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const queue = await getSubmissionQueue(actor);
  const offeringIds = [...new Set(queue.map((s) => s.offeringId))];
  const [offerings, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      offeringIds.length ? tx.query.courseOffering.findMany({ where: (o, { inArray }) => inArray(o.id, offeringIds) }) : Promise.resolve([]),
      tx.query.course.findMany(),
    ]),
  );
  const label = (offeringId: string) => {
    const o = offerings.find((o) => o.id === offeringId);
    const c = o ? courses.find((c) => c.id === o.courseId) : undefined;
    return o && c ? `${c.code} — ${c.title} (Section ${o.section})` : offeringId;
  };

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Grade submission review" />
      {queue.length === 0 && <p className="text-sm text-fg-muted">No submissions awaiting a decision.</p>}
      <ul className="flex flex-col gap-2">
        {queue.map((s) => (
          <li key={s.id}>
            <Card className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {label(s.offeringId)} — {s.undecidedCount} of {s.gradeCount} undecided
                {s.status === "PARTIALLY_DECIDED" && <span className="ml-1 text-xs text-warning-fg">(partially decided)</span>}
              </span>
              <Link href={`/admin/grade-review/${s.id}`} className="font-medium text-brand-fg hover:underline">
                Review
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
