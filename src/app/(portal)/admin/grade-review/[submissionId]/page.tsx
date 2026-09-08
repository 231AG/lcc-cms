import { getCurrentActor } from "@/lib/auth/session";
import { fullName } from "@/lib/students/name";
import { asUser } from "@/lib/db/asUser";
import { getSubmissionDetail } from "@/lib/grades/grades";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
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

  const detail = await getSubmissionDetail(actor, submissionId);
  if (!detail) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <p className="text-sm text-fg-muted">Submission not found.</p>
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
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title={`${course ? `${course.code} — ${course.title}` : submission.offeringId} (Section ${offering?.section})`}
        description={
          <>
            Attempt {submission.attemptNo} — status <Badge tone="brand">{submission.status}</Badge>
          </>
        }
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form>
        <Card className="mb-4">
          <Table>
            <Thead>
              <tr>
                <Th></Th>
                <Th>Student</Th>
                <Th>Grade</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {grades.map((g) => {
                const s = studentFor(g.registrationId);
                return (
                  <Tr key={g.id}>
                    <Td>
                      {g.status === "SUBMITTED" && (
                        <input
                          type="checkbox"
                          name="gradeRecordId"
                          value={g.id}
                          form="decision-form"
                          aria-label={`Select ${s ? fullName(s) : g.registrationId} for this decision`}
                          className="h-4 w-4 rounded border-line-strong"
                        />
                      )}
                    </Td>
                    <Td>{s ? `${s.studentNumber} — ${fullName(s)}` : g.registrationId}</Td>
                    <Td>
                      {g.letter}
                      {g.score ? ` (${g.score})` : ""}
                    </Td>
                    <Td className="text-xs text-fg-muted">
                      {g.status}
                      {g.decisionReason && <span className="ml-1 text-danger-fg">— {g.decisionReason}</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </form>

      {undecided.length > 0 && (
        <form id="decision-form" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="submissionId" value={submissionId} />
          <div className="flex-1">
            <Label className="text-xs">Reason (required to reject)</Label>
            <input name="reason" placeholder="Reason for rejection" className="w-64 rounded-md border border-line-strong px-3 py-2 text-sm" />
          </div>
          <Button type="submit" formAction={approveSubmissionAction}>
            Approve checked (or all, if none checked)
          </Button>
          <Button type="submit" formAction={rejectSubmissionAction} variant="danger">
            Reject checked (or all, if none checked)
          </Button>
        </form>
      )}
    </main>
  );
}
