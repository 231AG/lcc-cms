import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { isPlanningOpen, SEMESTER_STATE_LABEL, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { semesterDisplayName, semesterFullLabel } from "@/lib/academic/semesterName";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { fullName } from "@/lib/students/name";
import { getStudent } from "@/lib/students/students";
import { asUser } from "@/lib/db/asUser";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getMyPlan } from "@/lib/planning/planning";
import { getGradeSheet, trimCredits } from "@/lib/gradesheet/gradeSheet";
import { computeIncompleteDeadlineSemester, formatSemesterSortKey } from "@/lib/gpa/incompleteDeadline";
import { getAdminHomeSummary, getSuperAdminHomeSummary } from "@/lib/dashboard/home";
import { getStudentStatistics, type StudentStatistics } from "@/lib/dashboard/statistics";
import { Building2, CalendarDays, UserCheck, Users } from "lucide-react";
import { BarList, ColumnChart, StatTile, StatusBarList } from "@/components/charts/Charts";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Label, Select } from "@/components/ui/Form";
import { buttonClasses } from "@/components/ui/Button";
import { Printer } from "lucide-react";

export const metadata: Metadata = { title: "Home" };

/** Icon-only action button -- same shape, hover and focus ring as the
 *  Students and Offerings tables, with a title and an accessible name so the
 *  icon is never the only thing carrying the meaning. */
const iconAction =
  "inline-flex rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

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
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; semesterId?: string }>;
}) {
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
        ? { label: semesterFullLabel(year, sem), sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 } }
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

    // S-04: one semester's results at a time, newest first, chosen with a
    // year and a semester. Both lists hold only what this student actually
    // has results in, and the semester list is narrowed to the chosen year,
    // so the pair cannot be set to a combination with nothing behind it.
    const resultSemesterIds = [...new Set(history.map((r) => r.semesterId))].sort((a, b) => {
      const ka = semesterInfo(a)?.sortKey;
      const kb = semesterInfo(b)?.sortKey;
      if (!ka || !kb) return 0;
      return kb.yearStart - ka.yearStart || kb.sequence - ka.sequence;
    });
    const yearIdFor = (semesterId: string) => semesters.find((s) => s.id === semesterId)?.academicYearId;
    const yearLabelFor = (yearId: string) => academicYears.find((y) => y.id === yearId)?.label ?? yearId;
    // Derived from the semester list rather than listed separately, so the
    // two controls cannot fall out of step with each other.
    const resultYearIds = [...new Set(resultSemesterIds.map(yearIdFor).filter((id): id is string => !!id))];

    const { year: requestedYearId, semesterId: requestedSemesterId } = await searchParams;
    // Changing the year re-submits carrying the old semester, which usually
    // belongs to a different year; that falls through to the newest semester
    // of the year just chosen rather than to an error.
    const selectedYearId =
      requestedYearId && resultYearIds.includes(requestedYearId) ? requestedYearId : resultYearIds[0];
    const yearSemesterIds = resultSemesterIds.filter((id) => yearIdFor(id) === selectedYearId);
    const selectedSemesterId =
      requestedSemesterId && yearSemesterIds.includes(requestedSemesterId)
        ? requestedSemesterId
        : yearSemesterIds[0];
    // The same assembled figures the printed grade sheet uses, so the screen
    // and the paper cannot disagree about a grade point or a total.
    const sheet = selectedSemesterId ? await getGradeSheet(actor, actor.userId, selectedSemesterId) : null;
    const selectedInfo = selectedSemesterId ? semesterInfo(selectedSemesterId) : null;
    const selectedSummary = selectedSemesterId ? semesterSummaryFor(selectedSemesterId) : undefined;
    const planStatusLine =
      isPlanningOpen(currentSemester?.state as SemesterState) && !currentPlan
        ? "You have not started your course plan for this semester."
        : currentPlan?.status === "REJECTED"
          ? "Your course plan was returned and needs revision."
          : currentPlan?.status === "SUBMITTED"
            ? "Your course plan is awaiting approval."
            : null;

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 outline-none sm:py-12">
        <PageHeader
          title={
            <>
              {fullName(record)}
            </>
          }
          description={`Student ID ${record.studentNumber}`}
        />

        <Card className="mb-6">
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">Department</dt>
                <dd className="mt-0.5 font-medium text-fg">{department ? department.name : "—"}</dd>
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
                  {currentSemesterLabel
                    ? `${currentSemesterLabel} (${SEMESTER_STATE_LABEL[currentSemester!.state as SemesterState] ?? currentSemester!.state})`
                    : "No semester is currently open."}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {/* Guidance for the screen, not part of the record: a printed copy
            of a semester's results should not carry a note about a course
            plan for a different, later semester. */}
        {planStatusLine && (
          <Alert tone="warning" className="mb-6 print:hidden">
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
                  {cumulative ? `${cumulative.totalCreditsEarned} of 132 — ${cumulative.creditsToGraduation} remaining` : "—"}
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
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Semester results</CardTitle>
            {/* One control, not a Print beside a Download. Both would open
                the same print dialog, and what separates printing from
                saving happens inside it, on a Destination menu no page is
                allowed to preset -- browsers forbid that, or any site could
                push files at a reader. Two icons would promise a difference
                the software cannot deliver; one that names both outcomes
                tells the truth. It opens the College's grade sheet for the
                chosen semester: the letterhead document, A4 landscape, the
                same one the Registrar prints. */}
            {sheet && selectedSemesterId && (
              <Link
                href={`/portal/grade-sheet/${selectedSemesterId}?print=1`}
                title="Print or save as PDF"
                aria-label="Print or save as PDF"
                className={`${iconAction} print:hidden`}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </CardHeader>

          {resultSemesterIds.length > 0 && (
            <form method="GET" className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3 print:hidden sm:px-5">
              <div>
                <Label htmlFor="year" className="text-xs">
                  Year
                </Label>
                {/* Loads on choice; the button is the no-JavaScript fallback. */}
                <Select id="year" name="year" defaultValue={selectedYearId ?? ""} className="w-40 font-semibold" data-auto-submit="">
                  {resultYearIds.map((id) => (
                    <option key={id} value={id}>
                      {yearLabelFor(id)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="semesterId" className="text-xs">
                  Semester
                </Label>
                {/* Only the chosen year's semesters, so the pair is always a
                    combination this student has results for. */}
                <Select
                  id="semesterId"
                  name="semesterId"
                  defaultValue={selectedSemesterId ?? ""}
                  className="w-40 font-semibold"
                  data-auto-submit=""
                >
                  {yearSemesterIds.map((id) => {
                    const sem = semesters.find((x) => x.id === id);
                    return (
                      <option key={id} value={id}>
                        {sem ? semesterDisplayName(sem) : id}
                      </option>
                    );
                  })}
                </Select>
              </div>
              <button type="submit" className={buttonClasses("secondary", "md")}>
                View
              </button>
            </form>
          )}

          <CardBody>
            {!sheet && <p className="text-sm text-fg-muted">No results yet.</p>}
            {sheet && (
              <>
                <h3 className="mb-2 text-sm font-semibold text-fg">{selectedInfo?.label ?? selectedSemesterId}</h3>
                <Table>
                  <Thead>
                    <tr>
                      <Th>Course Title</Th>
                      <Th className="text-center">Code</Th>
                      <Th className="text-center">Cr/Hrs</Th>
                      <Th className="text-center">Grade</Th>
                      <Th className="text-center">Grade Point</Th>
                      <Th className="text-center">Grade Points</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {sheet.courses.length === 0 && (
                      <Tr>
                        <Td colSpan={6} className="text-center text-fg-muted">
                          No results are recorded for this semester.
                        </Td>
                      </Tr>
                    )}
                    {sheet.courses.map((c, i) => (
                      <Tr key={`${c.code}-${i}`} className={i % 2 === 1 ? "bg-brand-subtle" : undefined}>
                        <Td>
                          {c.title}
                          {c.isRepeatDropped && " (R)"}
                          {c.letter === "I" && selectedInfo && (
                            <span className="ml-1 text-xs text-warning-fg">
                              — must be resolved by end of{" "}
                              {formatSemesterSortKey(computeIncompleteDeadlineSemester(selectedInfo.sortKey))}
                            </span>
                          )}
                        </Td>
                        <Td className="text-center whitespace-nowrap">{c.code}</Td>
                        <Td className="text-center">{c.creditHours}</Td>
                        <Td className="text-center">{c.letter}</Td>
                        <Td className="text-center">{c.gradePoint ?? "—"}</Td>
                        <Td className="text-center">{c.gradePoints ?? "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                  {/* The semester's own figures belong under the rows they
                      are drawn from, which is also where the printed sheet
                      puts them. No fill: the purple band is the heading's
                      job, and a second one at the foot competes with it.
                      What separates the totals from the results is a rule
                      twice the weight of the ones between rows -- a line
                      the eye reads as "below this is a different kind of
                      number". CGPA stays in the Academic record card above:
                      it is cumulative and says nothing about this table. */}
                  <tfoot className="text-fg">
                    <tr>
                      <td colSpan={5} className="border-t-2 border-brand-fg px-3 py-2 text-right font-bold">
                        Total Credit Earned
                      </td>
                      <td className="border-t-2 border-brand-fg px-3 py-2 text-right font-bold">
                        {trimCredits(sheet.summary.creditsEarned)}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right font-bold">
                        Total Grade Points
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{sheet.summary.totalGradePoints}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right font-bold">
                        Semester GPA
                        {selectedSummary?.isProvisional && (
                          <span className="ml-1 text-xs font-normal text-fg-muted">(provisional)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{sheet.summary.gpa ?? "—"}</td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
          </CardBody>
        </Card>
      </main>
    );
  }

  if (actor.role === "SUPER_ADMIN") {
    // The queues and the statistics share nothing, so they are fetched
    // together rather than one after the other.
    const [summary, stats] = await Promise.all([getSuperAdminHomeSummary(actor), getStudentStatistics(actor)]);
    const nothingWaiting = summary.submissionsAwaitingApproval === 0 && summary.correctionsAwaitingDecision === 0;

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 outline-none sm:py-12">
        <PageHeader title="Super Admin home" description={`Signed in as ${actor.displayName}.`} />

        <StatisticsSection stats={stats} semesterCount={summary.semesterStates.length} />

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
                    <SemesterStateBadge state={s.state} />
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
  const [summary, stats] = await Promise.all([getAdminHomeSummary(actor), getStudentStatistics(actor)]);
  const nothingWaiting =
    summary.plansAwaitingApproval === 0 && summary.classesNotYetSubmitted === 0 && summary.rejectedGradesNeedingRework === 0;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 outline-none sm:py-12">
      <PageHeader title="Admin home" description={`Signed in as ${actor.displayName}.`} />

      <StatisticsSection stats={stats} />

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


/**
 * The at-a-glance statistics both staff dashboards now open with: one
 * headline figure and three breakdowns of the student body.
 *
 * Identical for Admin and Super Admin on purpose -- "how many students are
 * there, and where are they" is not a role-specific question, and the two
 * roles' work queues below already differ, which is where the difference
 * belongs. The queues are untouched by this section.
 */
function StatisticsSection({ stats, semesterCount }: { stats: StudentStatistics; semesterCount?: number }) {
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total students" value={stats.total} icon={<Users className="h-5 w-5" />} tone="brand" />
        <StatTile
          label="Active"
          value={stats.byStatus.find((s) => s.label === "ACTIVE")?.count ?? 0}
          hint={stats.total > 0 ? `${Math.round(((stats.byStatus.find((s) => s.label === "ACTIVE")?.count ?? 0) / stats.total) * 100)}% of all students` : undefined}
          icon={<UserCheck className="h-5 w-5" />}
          tone="success"
        />
        <StatTile
          label="Colleges represented"
          value={stats.byCollege.length}
          icon={<Building2 className="h-5 w-5" />}
          tone="info"
        />
        <StatTile
          label={semesterCount === undefined ? "Enrolment years" : "Semesters"}
          value={semesterCount ?? stats.byEnrolmentYear.length}
          icon={<CalendarDays className="h-5 w-5" />}
          tone="accent"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Students by status</CardTitle>
          </CardHeader>
          <CardBody>
            <StatusBarList data={stats.byStatus} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Students by gender</CardTitle>
          </CardHeader>
          <CardBody>
            {/* "Not recorded" is a row here rather than an omission: gender
                was added after most of these students were enrolled, so for
                a while it is the largest bar, and a chart that hid it would
                add up to less than the total beside it. */}
            <BarList data={stats.byGender} emptyMessage="No students are enrolled yet." />
          </CardBody>
        </Card>
      </div>

      {/* College moved to its own row when gender took its place above:
          college names are long, and they read far better across the full
          width than wrapped into a half. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Students by college</CardTitle>
        </CardHeader>
        <CardBody>
          <BarList data={stats.byCollege} emptyMessage="No students are enrolled in any college yet." />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Students by enrolment year</CardTitle>
        </CardHeader>
        <CardBody>
          <ColumnChart data={stats.byEnrolmentYear} />
        </CardBody>
      </Card>
    </>
  );
}
