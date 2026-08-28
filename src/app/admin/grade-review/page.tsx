import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getSubmissionQueue } from "@/lib/grades/grades";

/**
 * X-02 (plan Section 24.11, Stage 10): submissions awaiting a decision.
 * Super Admin only -- an Admin can submit a class but never approve or
 * reject one (Section 15.1).
 */
export default async function GradeReviewQueuePage() {
  const actor = await getCurrentActor();

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
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
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Grade submission review</h1>
      {queue.length === 0 && <p className="text-sm text-gray-500">No submissions awaiting a decision.</p>}
      <ul className="flex flex-col gap-2">
        {queue.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
            <span>
              {label(s.offeringId)} — {s.undecidedCount} of {s.gradeCount} undecided
              {s.status === "PARTIALLY_DECIDED" && <span className="ml-1 text-xs text-amber-700">(partially decided)</span>}
            </span>
            <Link href={`/admin/grade-review/${s.id}`} className="text-blue-700 underline">Review</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
