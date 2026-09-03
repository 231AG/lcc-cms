import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent, STUDENT_STATUSES } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getPlansForStudent } from "@/lib/planning/planning";
import { can } from "@/lib/permissions/kernel";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { updateStudentProfileAction } from "../actions";
import { ResetPasswordForm } from "../ResetPasswordForm";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * A-10 (plan Section 20.5). Stage 5 built this as structure only; Stage 6
 * added entered history; Stage 7 adds GPA/CGPA, academic standing, and
 * outstanding mandatory repeats (plans and system grades are Stages 9/10).
 */
export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; mode?: string }>;
}) {
  const actor = await getCurrentActor();
  const { id } = await params;
  const { error, mode } = await searchParams;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  let record;
  try {
    record = await getStudent(actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
          <Alert tone="info">Student not found.</Alert>
        </main>
      );
    }
    throw err;
  }

  const [departments, history, semesters, academicYears, semesterSummaries, cumulative, obligations, courses] = await asUser(
    actor.userId,
    (tx) =>
      Promise.all([
        tx.query.department.findMany({ orderBy: (d, { asc }) => asc(d.code) }),
        getStudentHistory(actor, record.id),
        tx.query.semester.findMany(),
        tx.query.academicYear.findMany(),
        getSemesterSummaries(actor, record.id),
        getCumulativeSummary(actor, record.id),
        getOutstandingRepeatObligations(actor, record.id),
        tx.query.course.findMany(),
      ]),
  );
  const semesterSummaryFor = (semesterId: string) => semesterSummaries.find((s) => s.semesterId === semesterId);
  const yearLabel = (semesterId: string) => {
    const sem = semesters.find((s) => s.id === semesterId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semesterId;
  };
  const courseLabel = (courseId: string) => {
    const c = courses.find((c) => c.id === courseId);
    return c ? `${c.code} — ${c.title}` : courseId;
  };

  const isAdmin = actor.role === "ADMIN";
  // View is read-only regardless of role; Edit is the pre-existing
  // editable form, still Admin-only. Super Admin reaching this page
  // directly (its "View" link, Section 20.5's read-only extension) is
  // always view-only, same as before.
  const canEdit = isAdmin && mode !== "view";
  const canReviewPlans = isAdmin && (await can(actor, "planning.reviewPlan"));
  const plans = canReviewPlans ? await getPlansForStudent(actor, record.id) : [];

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title={
          <>
            {record.firstName} {record.lastName}
          </>
        }
        description={`Student ID ${record.studentNumber}`}
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={updateStudentProfileAction} className="flex flex-col gap-3">
            <input type="hidden" name="studentId" value={record.id} />
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="firstName" className="text-xs">
                  First name
                </Label>
                <Input id="firstName" name="firstName" defaultValue={record.firstName} disabled={!canEdit} required />
              </div>
              <div className="flex-1">
                <Label htmlFor="lastName" className="text-xs">
                  Last name
                </Label>
                <Input id="lastName" name="lastName" defaultValue={record.lastName} disabled={!canEdit} required />
              </div>
            </div>
            <div>
              <Label htmlFor="departmentId" className="text-xs">
                Department
              </Label>
              <Select id="departmentId" name="departmentId" defaultValue={record.departmentId} disabled={!canEdit}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="enrolmentYear" className="text-xs">
                Enrolment year
              </Label>
              <Input id="enrolmentYear" name="enrolmentYear" type="number" defaultValue={record.enrolmentYear} disabled={!canEdit} className="w-32" />
            </div>
            <div>
              <Label htmlFor="contactPhone" className="text-xs">
                Contact phone
              </Label>
              <Input id="contactPhone" name="contactPhone" defaultValue={record.contactPhone ?? ""} disabled={!canEdit} className="max-w-xs" />
            </div>
            <div>
              <Label htmlFor="status" className="text-xs">
                Status
              </Label>
              <Select id="status" name="status" defaultValue={record.status} disabled={!canEdit} className="max-w-xs">
                {STUDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-fg-muted">Import status: {record.historicalImportStatus}</p>
            {canEdit && (
              <Button type="submit" className="w-fit">
                Save changes
              </Button>
            )}
          </form>
        </CardBody>
      </Card>

      {canEdit && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-fg-muted">Issues a new temporary password and forces a change on next login.</p>
            <ResetPasswordForm studentId={record.id} />
          </CardBody>
        </Card>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>GPA and CGPA</CardTitle>
        </CardHeader>
        <CardBody>
          {(cumulative?.isProvisional ?? true) && (
            <Alert tone="warning" className="mb-3 text-xs">
              Provisional -- based on records entered so far.
            </Alert>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">CGPA</dt>
            <dd className="font-medium text-fg">{cumulative?.cgpa ?? "—"}</dd>
            <dt className="text-fg-muted">Academic standing</dt>
            <dd className="font-medium text-fg">{cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}</dd>
            <dt className="text-fg-muted">Credits earned</dt>
            <dd className="font-medium text-fg">
              {cumulative ? `${cumulative.totalCreditsEarned} of 132 -- ${cumulative.creditsToGraduation} remaining` : "—"}
            </dd>
            <dt className="text-fg-muted">Credits attempted</dt>
            <dd className="font-medium text-fg">{cumulative?.totalCreditsAttempted ?? "—"}</dd>
          </dl>
          {obligations.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-warning-fg">Outstanding mandatory repeats:</p>
              <ul className="list-disc pl-5 text-sm">
                {obligations.map((o) => (
                  <li key={o.recordId}>
                    {o.courseCode} — {o.courseTitle} ({o.letter})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      {canReviewPlans && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Planned courses</CardTitle>
          </CardHeader>
          <CardBody>
            {plans.length === 0 && <p className="text-sm text-fg-muted">No course plans on record.</p>}
            {plans.length > 0 && (
              <div className="flex flex-col gap-4">
                {plans.map((p) => (
                  <div key={p.id}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-fg">{yearLabel(p.semesterId)}</span>
                      <Badge tone={p.status === "APPROVED" ? "success" : p.status === "REJECTED" ? "danger" : p.status === "PARTIALLY_APPROVED" ? "warning" : "brand"}>
                        {p.status}
                      </Badge>
                    </div>
                    <ul className="list-disc pl-5 text-sm text-fg-secondary">
                      {p.items.map((i) => (
                        <li key={i.id}>
                          {courseLabel(i.courseId)}
                          {i.isRetake && " — retake"}
                          {p.status !== "DRAFT" && ` — ${i.status.toLowerCase()}`}
                          {i.status === "REJECTED" && i.rejectionReason && ` (${i.rejectionReason})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Academic history</CardTitle>
          {canEdit && (
            <Link href={`/admin/historical?studentId=${record.id}`} className="text-sm font-medium text-brand-fg hover:underline">
              Enter historical record
            </Link>
          )}
        </CardHeader>
        <CardBody>
          {history.length === 0 && (
            <p className="text-sm text-fg-muted">
              Empty -- the import status above explains why nothing appears here yet.
            </p>
          )}
          {history.length > 0 && (
            <Table>
              <Thead>
                <tr>
                  <Th>Semester</Th>
                  <Th>Course</Th>
                  <Th>Credits</Th>
                  <Th>Grade</Th>
                  <Th>Semester GPA</Th>
                </tr>
              </Thead>
              <tbody>
                {history.map((r, i) => {
                  const showSemesterGpa = i === 0 || history[i - 1].semesterId !== r.semesterId;
                  const summary = semesterSummaryFor(r.semesterId);
                  return (
                    <Tr key={r.id}>
                      <Td>{yearLabel(r.semesterId)}</Td>
                      <Td>
                        {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                      </Td>
                      <Td>{r.creditHours}</Td>
                      <Td>
                        {r.letter}
                        {r.isRepeatDropped && " (R)"}
                      </Td>
                      <Td>{showSemesterGpa ? (summary?.gpa ?? "—") : ""}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
