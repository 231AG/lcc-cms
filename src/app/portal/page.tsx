import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudent } from "@/lib/students/students";
import { asUser } from "@/lib/db/asUser";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getMyPlan } from "@/lib/planning/planning";
import { computeIncompleteDeadlineSemester, formatSemesterSortKey } from "@/lib/gpa/incompleteDeadline";
import { getAdminHomeSummary, getSuperAdminHomeSummary } from "@/lib/dashboard/home";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Table, Tr, Td } from "@/components/ui/Table";
import PrintButton from "./PrintButton";

export const metadata: Metadata = { title: "Home" };

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * Landing page. Students see S-09 (their own read-only profile, plan
 * Section 20.3) as of Stage 5. Admin/Super Admin see the Stage 2
 * placeholder plus a plain list of the screens available to their role --
 * full role-specific dashboards (A-01/X-01) are their own later screens,
 * but every stage since 2 has shipped a real admin page with no way to
 * reach it except typing the URL, which is a genuine dead end.
 */
export default async function PortalPage() {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect("/login");
  }

  if (actor.mustChangePassword) {
    redirect("/change-password");
  }

  if (actor.role === "STUDENT") {
    const record = await getStudent(actor, actor.userId);
    const [department, history, semesterSummaries, cumulative, obligations, semesters, academicYears] = await Promise.all([
      asUser(actor.userId, (tx) => tx.query.department.findFirst({ where: (d, { eq }) => eq(d.id, record.departmentId) })),
      getStudentHistory(actor, actor.userId),
      getSemesterSummaries(actor, actor.userId),
      getCumulativeSummary(actor, actor.userId),
      getOutstandingRepeatObligations(actor, actor.userId),
      asUser(actor.userId, (tx) => tx.query.semester.findMany()),
      asUser(actor.userId, (tx) => tx.query.academicYear.findMany()),
    ]);

    const semesterInfo = (semesterId: string) => {
      const sem = semesters.find((s) => s.id === semesterId);
      const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
      return sem && year
        ? { label: `${year.label} — ${sem.name}`, sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 } }
        : null;
    };
    const semesterSummaryFor = (semesterId: string) => semesterSummaries.find((s) => s.semesterId === semesterId);
    const isProvisional = cumulative?.isProvisional ?? record.historicalImportStatus !== "COMPLETE";

    // S-03 (plan Section 20.3): "current semester and its state" -- the
    // most recently started semester that is not DRAFT or CLOSED, if any.
    const currentSemester = semesters
      .filter((s) => s.state !== "DRAFT" && s.state !== "CLOSED")
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
    const currentSemesterLabel = currentSemester ? semesterInfo(currentSemester.id)?.label : null;

    // S-03's "single status line if a course plan needs attention" --
    // only fetched when there is a current semester to have a plan in.
    const currentPlan = currentSemester ? await getMyPlan(actor, currentSemester.id) : null;
    const planStatusLine =
      currentSemester?.state === "REGISTRATION" && !currentPlan
        ? "You have not started your course plan for this semester."
        : currentPlan?.status === "REJECTED"
          ? "Your course plan was returned and needs revision."
          : currentPlan?.status === "SUBMITTED"
            ? "Your course plan is awaiting approval."
            : null;

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:py-12">
        <PageHeader
          title={
            <>
              {record.firstName} {record.lastName}
            </>
          }
          description={`Student ID ${record.studentNumber}`}
        />

        <Card className="mb-6">
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">Department</dt>
                <dd className="mt-0.5 font-medium text-fg">{department ? `${department.code} — ${department.name}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Enrolment year</dt>
                <dd className="mt-0.5 font-medium text-fg">{record.enrolmentYear}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Status</dt>
                <dd className="mt-0.5 font-medium text-fg">{record.status}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Current semester</dt>
                <dd className="mt-0.5 font-medium text-fg">
                  {currentSemesterLabel ? `${currentSemesterLabel} (${currentSemester!.state})` : "No semester is currently open."}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {planStatusLine && (
          <Alert tone="warning" className="mb-6">
            {planStatusLine}
          </Alert>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Academic record</CardTitle>
          </CardHeader>
          <CardBody>
            {isProvisional && (
              <Alert tone="warning" className="mb-4 text-xs">
                Provisional -- based on records entered so far. Your academic history is still being entered by the
                Admin office.
              </Alert>
            )}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">CGPA</dt>
                <dd className="mt-0.5 text-lg font-semibold text-brand-fg">{cumulative?.cgpa ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Academic standing</dt>
                <dd className="mt-0.5 font-medium text-fg">
                  {cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Credits earned</dt>
                <dd className="mt-0.5 font-medium text-fg">
                  {cumulative ? `${cumulative.totalCreditsEarned} of 132 -- ${cumulative.creditsToGraduation} remaining` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Credits attempted</dt>
                <dd className="mt-0.5 font-medium text-fg">{cumulative?.totalCreditsAttempted ?? "—"}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {obligations.length > 0 && (
          <Card className="mb-6 border-warning-line bg-warning-surface">
            <CardBody>
              <CardTitle className="mb-2">Outstanding repeats</CardTitle>
              <ul className="list-disc pl-5 text-sm text-warning-fg">
                {obligations.map((o) => (
                  <li key={o.recordId}>
                    {o.courseCode} — {o.courseTitle} ({o.letter})
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Semesters</CardTitle>
          </CardHeader>
          <CardBody>
            {history.length === 0 && <p className="text-sm text-fg-muted">No results yet.</p>}
            {[...new Set(history.map((r) => r.semesterId))].map((semesterId, index) => {
              const info = semesterInfo(semesterId);
              const summary = semesterSummaryFor(semesterId);
              const courses = history.filter((r) => r.semesterId === semesterId);
              return (
                <div key={semesterId} className={index > 0 ? "mt-6 border-t border-line-subtle pt-6" : ""}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold text-fg">{info?.label ?? semesterId}</h3>
                    <span className="flex items-center gap-2 text-xs text-fg-muted">
                      GPA {summary?.gpa ?? "—"} {summary?.isProvisional && "(provisional)"}
                      <PrintButton semesterId={semesterId} />
                    </span>
                  </div>
                  <Table>
                    <tbody>
                      {courses.map((c) => (
                        <Tr key={c.id}>
                          <Td>
                            {c.courseCodeSnapshot} — {c.courseTitleSnapshot}
                          </Td>
                          <Td>{c.creditHours}cr</Td>
                          <Td>
                            {c.letter}
                            {c.isRepeatDropped && " (R)"}
                            {c.letter === "I" && info && (
                              <span className="ml-1 text-xs text-warning-fg">
                                -- must be resolved by end of {formatSemesterSortKey(computeIncompleteDeadlineSemester(info.sortKey))}
                              </span>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </main>
    );
  }

  if (actor.role === "SUPER_ADMIN") {
    const summary = await getSuperAdminHomeSummary(actor);
    const nothingWaiting = summary.submissionsAwaitingApproval === 0 && summary.correctionsAwaitingDecision === 0;

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:py-12">
        <PageHeader title="Super Admin home" description={`Signed in as ${actor.displayName}.`} />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Awaiting your approval</CardTitle>
          </CardHeader>
          <CardBody>
            {nothingWaiting ? (
              <p className="text-sm text-fg-muted">Nothing is awaiting your approval.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                <li>
                  <Link href="/admin/grade-review" className="font-medium text-brand-fg hover:underline">
                    {summary.submissionsAwaitingApproval} grade submission(s) awaiting approval
                  </Link>
                </li>
                <li>
                  <Link href="/admin/grade-corrections" className="font-medium text-brand-fg hover:underline">
                    {summary.correctionsAwaitingDecision} correction(s) awaiting decision
                  </Link>
                </li>
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Semester states</CardTitle>
          </CardHeader>
          <CardBody>
            {summary.semesterStates.length === 0 ? (
              <p className="text-sm text-fg-muted">No semesters exist yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-subtle text-sm">
                {summary.semesterStates.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                    <span className="text-fg">{s.label}</span>
                    <Badge tone={semesterStateTone(s.state)}>{s.state}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </main>
    );
  }

  // ADMIN
  const summary = await getAdminHomeSummary(actor);
  const nothingWaiting =
    summary.plansAwaitingApproval === 0 && summary.classesNotYetSubmitted === 0 && summary.rejectedGradesNeedingRework === 0;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:py-12">
      <PageHeader title="Admin home" description={`Signed in as ${actor.displayName}.`} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Work queues</CardTitle>
        </CardHeader>
        <CardBody>
          {nothingWaiting ? (
            <p className="text-sm text-fg-muted">Nothing is waiting for you.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {summary.plansAwaitingApproval > 0 && (
                <li>
                  <Link href="/admin/planning" className="font-medium text-brand-fg hover:underline">
                    {summary.plansAwaitingApproval} plan(s) awaiting approval
                  </Link>
                </li>
              )}
              {summary.classesNotYetSubmitted > 0 && (
                <li>
                  <Link href="/admin/grades" className="font-medium text-brand-fg hover:underline">
                    {summary.classesNotYetSubmitted} class(es) with grades not yet submitted
                  </Link>
                </li>
              )}
              {summary.rejectedGradesNeedingRework > 0 && (
                <li>
                  <Link href="/admin/grades" className="font-medium text-brand-fg hover:underline">
                    {summary.rejectedGradesNeedingRework} grade(s) rejected and needing rework
                  </Link>
                </li>
              )}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historical import</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col divide-y divide-line-subtle text-sm">
            {Object.entries(summary.importByStatus).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <span className="text-fg">{status}</span>
                <span className="font-medium text-fg">{count}</span>
              </li>
            ))}
          </ul>
          <Link href="/admin/historical/progress" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-fg hover:underline">
            Full progress report
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}

function semesterStateTone(state: string): "neutral" | "brand" | "success" | "warning" | "info" {
  switch (state) {
    case "OPEN":
      return "success";
    case "REGISTRATION":
      return "info";
    case "IN_PROGRESS":
      return "brand";
    case "CLOSED":
      return "neutral";
    default:
      return "neutral";
  }
}
