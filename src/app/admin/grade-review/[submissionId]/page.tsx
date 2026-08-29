import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getSubmissionDetail } from "@/lib/grades/grades";
import { approveSubmissionAction, rejectSubmissionAction } from "../actions";

/**
 * X-02's detail half: one submission, its grades, and the decision.
 * Checking specific rows before Approve/Reject acts on just those (CR-06
 * individual); leaving none checked acts on the whole batch. Both
 * buttons submit the SAME form (via formAction) so they see the same
 * checked rows -- two separate forms can't share one checkbox set.
 */
export default async function GradeReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { submissionId } = await params;
  const { error } = await searchParams;

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

  const detail = await getSubmissionDetail(actor, submissionId);
  if (!detail) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="text-sm text-gray-500">Submission not found.</p>
      </main>
    );
  }
  const { submission, grades } = detail;

  const registrationIds = grades.map((g) => g.registrationId);
  const [registrations, offering] = await asUser(actor.userId, (tx) =>
    Promise.all([
      registrationIds.length ? tx.query.registration.findMany({ where: (r, { inArray }) => inArray(r.id, registrationIds) }) : Promise.resolve([]),
      tx.query.courseOffering.findFirst({ where: (o, { eq }) => eq(o.id, submission.offeringId) }),
    ]),
  );
  const studentIds = registrations.map((r) => r.studentId);
  const [students, course] = await asUser(actor.userId, (tx) =>
    Promise.all([
      studentIds.length ? tx.query.student.findMany({ where: (s, { inArray }) => inArray(s.id, studentIds) }) : Promise.resolve([]),
      offering ? tx.query.course.findFirst({ where: (c, { eq }) => eq(c.id, offering.courseId) }) : Promise.resolve(undefined),
    ]),
  );
  const studentFor = (registrationId: string) => {
    const reg = registrations.find((r) => r.id === registrationId);
    return reg ? students.find((s) => s.id === reg.studentId) : undefined;
  };

  const undecided = grades.filter((g) => g.status === "SUBMITTED");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">
        {course ? `${course.code} — ${course.title}` : submission.offeringId} (Section {offering?.section})
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        Attempt {submission.attemptNo} — status <span className="font-medium">{submission.status}</span>
      </p>

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <form>
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-1 pr-2"></th>
              <th className="py-1 pr-2">Student</th>
              <th className="py-1 pr-2">Grade</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => {
              const s = studentFor(g.registrationId);
              return (
                <tr key={g.id} className="border-b">
                  <td className="py-1.5 pr-2">
                    {g.status === "SUBMITTED" && (
                      <input
                        type="checkbox"
                        name="gradeRecordId"
                        value={g.id}
                        form="decision-form"
                        aria-label={`Select ${s ? `${s.firstName} ${s.lastName}` : g.registrationId} for this decision`}
                      />
                    )}
                  </td>
                  <td className="py-1.5 pr-2">{s ? `${s.studentNumber} — ${s.firstName} ${s.lastName}` : g.registrationId}</td>
                  <td className="py-1.5 pr-2">{g.letter}{g.score ? ` (${g.score})` : ""}</td>
                  <td className="py-1.5 text-xs text-gray-500">
                    {g.status}
                    {g.decisionReason && <span className="ml-1 text-red-700">— {g.decisionReason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>

      {undecided.length > 0 && (
        <form id="decision-form" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="submissionId" value={submissionId} />
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium">Reason (required to reject)</label>
            <input name="reason" placeholder="Reason for rejection" className="w-64 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <button type="submit" formAction={approveSubmissionAction} className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
            Approve checked (or all, if none checked)
          </button>
          <button type="submit" formAction={rejectSubmissionAction} className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700">
            Reject checked (or all, if none checked)
          </button>
        </form>
      )}
    </main>
  );
}
