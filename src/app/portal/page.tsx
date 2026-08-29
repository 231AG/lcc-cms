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
import PrintButton from "./PrintButton";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

const ADMIN_LINKS = [
  { href: "/admin/students", label: "Students" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/structure", label: "Academic structure" },
  { href: "/admin/calendar", label: "Academic calendar" },
  { href: "/admin/offerings", label: "Course offerings" },
  { href: "/admin/planning", label: "Course plan review" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/grades", label: "Class grade entry" },
  { href: "/admin/grade-corrections", label: "Grade corrections" },
  { href: "/admin/export", label: "Semester export" },
  { href: "/grading-policy", label: "Grading policy" },
];

const SUPER_ADMIN_LINKS = [
  { href: "/admin/accounts", label: "Admin accounts" },
  { href: "/admin/students", label: "Students (read-only)" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/calendar", label: "Academic calendar (read-only)" },
  { href: "/admin/offerings", label: "Course offerings (read-only)" },
  { href: "/admin/grade-review", label: "Grade submission review" },
  { href: "/admin/export", label: "Semester export" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/grading-policy", label: "Grading policy" },
  { href: "/admin/grade-corrections", label: "Grade corrections" },
];

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
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-2 text-xl font-semibold">
          {record.firstName} {record.lastName}
        </h1>
        <p className="mb-6 text-sm text-gray-500">Student ID {record.studentNumber}</p>
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Department</dt>
          <dd>{department ? `${department.code} — ${department.name}` : "—"}</dd>
          <dt className="text-gray-500">Enrolment year</dt>
          <dd>{record.enrolmentYear}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd>{record.status}</dd>
          <dt className="text-gray-500">Current semester</dt>
          <dd>{currentSemesterLabel ? `${currentSemesterLabel} (${currentSemester!.state})` : "No semester is currently open."}</dd>
        </dl>

        {planStatusLine && (
          <p className="mb-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{planStatusLine}</p>
        )}

        <section className="mb-6 rounded border border-gray-200 p-4">
          <h2 className="mb-2 font-medium">Academic record</h2>
          {isProvisional && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Provisional -- based on records entered so far. Your academic history is still being entered by the
              Admin office.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">CGPA</dt>
            <dd>{cumulative?.cgpa ?? "—"}</dd>
            <dt className="text-gray-500">Academic standing</dt>
            <dd>{cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}</dd>
            <dt className="text-gray-500">Credits earned</dt>
            <dd>{cumulative ? `${cumulative.totalCreditsEarned} of 132 -- ${cumulative.creditsToGraduation} remaining` : "—"}</dd>
            <dt className="text-gray-500">Credits attempted</dt>
            <dd>{cumulative?.totalCreditsAttempted ?? "—"}</dd>
          </dl>
        </section>

        {obligations.length > 0 && (
          <section className="mb-6 rounded border border-amber-300 bg-amber-50 p-4">
            <h2 className="mb-2 font-medium">Outstanding repeats</h2>
            <ul className="list-disc pl-5 text-sm">
              {obligations.map((o) => (
                <li key={o.recordId}>
                  {o.courseCode} — {o.courseTitle} ({o.letter})
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded border border-gray-200 p-4">
          <h2 className="mb-3 font-medium">Semesters</h2>
          {history.length === 0 && <p className="text-sm text-gray-500">No results yet.</p>}
          {[...new Set(history.map((r) => r.semesterId))].map((semesterId) => {
            const info = semesterInfo(semesterId);
            const summary = semesterSummaryFor(semesterId);
            const courses = history.filter((r) => r.semesterId === semesterId);
            return (
              <div key={semesterId} className="mb-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">{info?.label ?? semesterId}</h3>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    GPA {summary?.gpa ?? "—"} {summary?.isProvisional && "(provisional)"}
                    <PrintButton semesterId={semesterId} />
                  </span>
                </div>
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="py-1">
                          {c.courseCodeSnapshot} — {c.courseTitleSnapshot}
                        </td>
                        <td className="py-1">{c.creditHours}cr</td>
                        <td className="py-1">
                          {c.letter}
                          {c.isRepeatDropped && " (R)"}
                          {c.letter === "I" && info && (
                            <span className="ml-1 text-xs text-amber-700">
                              -- must be resolved by end of {formatSemesterSortKey(computeIncompleteDeadlineSemester(info.sortKey))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        <p className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/planning" className="text-blue-700 underline">
            Course planning
          </Link>
          <Link href="/grading-policy" className="text-blue-700 underline">
            Grading policy
          </Link>
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </p>
      </main>
    );
  }

  const links = actor.role === "SUPER_ADMIN" ? SUPER_ADMIN_LINKS : ADMIN_LINKS;

  if (actor.role === "SUPER_ADMIN") {
    const summary = await getSuperAdminHomeSummary(actor);
    const nothingWaiting = summary.submissionsAwaitingApproval === 0 && summary.correctionsAwaitingDecision === 0;

    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-6 text-xl font-semibold">Super Admin home</h1>

        <section className="mb-6 rounded border border-gray-200 p-4">
          <h2 className="mb-2 font-medium">Awaiting your approval</h2>
          {nothingWaiting ? (
            <p className="text-sm text-gray-500">Nothing is awaiting your approval.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                <Link href="/admin/grade-review" className="text-blue-700 underline">
                  {summary.submissionsAwaitingApproval} grade submission(s) awaiting approval
                </Link>
              </li>
              <li>
                <Link href="/admin/grade-corrections" className="text-blue-700 underline">
                  {summary.correctionsAwaitingDecision} correction(s) awaiting decision
                </Link>
              </li>
            </ul>
          )}
        </section>

        <section className="mb-6 rounded border border-gray-200 p-4">
          <h2 className="mb-2 font-medium">Semester states</h2>
          {summary.semesterStates.length === 0 ? (
            <p className="text-sm text-gray-500">No semesters exist yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.semesterStates.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{s.label}</span>
                  <span className="text-gray-500">{s.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ul className="flex flex-col gap-2 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-blue-700 underline">
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/change-password" className="text-blue-700 underline">
              Change password
            </Link>
          </li>
        </ul>
      </main>
    );
  }

  // ADMIN
  const summary = await getAdminHomeSummary(actor);
  const nothingWaiting =
    summary.plansAwaitingApproval === 0 && summary.classesNotYetSubmitted === 0 && summary.rejectedGradesNeedingRework === 0;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-xl font-semibold">Admin home</h1>

      <section className="mb-6 rounded border border-gray-200 p-4">
        <h2 className="mb-2 font-medium">Work queues</h2>
        {nothingWaiting ? (
          <p className="text-sm text-gray-500">Nothing is waiting for you.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {summary.plansAwaitingApproval > 0 && (
              <li>
                <Link href="/admin/planning" className="text-blue-700 underline">
                  {summary.plansAwaitingApproval} plan(s) awaiting approval
                </Link>
              </li>
            )}
            {summary.classesNotYetSubmitted > 0 && (
              <li>
                <Link href="/admin/grades" className="text-blue-700 underline">
                  {summary.classesNotYetSubmitted} class(es) with grades not yet submitted
                </Link>
              </li>
            )}
            {summary.rejectedGradesNeedingRework > 0 && (
              <li>
                <Link href="/admin/grades" className="text-blue-700 underline">
                  {summary.rejectedGradesNeedingRework} grade(s) rejected and needing rework
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="mb-6 rounded border border-gray-200 p-4">
        <h2 className="mb-2 font-medium">Historical import</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {Object.entries(summary.importByStatus).map(([status, count]) => (
            <li key={status} className="flex justify-between">
              <span>{status}</span>
              <span className="text-gray-500">{count}</span>
            </li>
          ))}
        </ul>
        <Link href="/admin/historical/progress" className="mt-2 inline-block text-blue-700 underline">
          Full progress report
        </Link>
      </section>

      <ul className="flex flex-col gap-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-blue-700 underline">
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </li>
      </ul>
    </main>
  );
}
