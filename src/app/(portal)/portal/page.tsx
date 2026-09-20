import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { isPlanningOpen, pickCurrentSemester, SEMESTER_STATE_LABEL, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { semesterDisplayName, semesterFullLabel } from "@/lib/academic/semesterName";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { fullName } from "@/lib/students/name";
import { getStudent } from "@/lib/students/students";
import { getStudentPhotoMeta } from "@/lib/students/photo";
import { asUser } from "@/lib/db/asUser";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getMyPlan, getPlanItems } from "@/lib/planning/planning";
import { getOfferingMeetingsForOfferings, getOfferingsByIds } from "@/lib/offerings/offerings";
import { formatMeetingSlots } from "@/lib/offerings/offeringRows";
import { getGradeSheet } from "@/lib/gradesheet/gradeSheet";
import { getAdminHomeSummary, getSuperAdminHomeSummary } from "@/lib/dashboard/home";
import { getStudentStatistics, type StudentStatistics } from "@/lib/dashboard/statistics";
import {
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  History,
  PieChart,
  School,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BarList, ColumnChart, StatTile, StatusBarList } from "@/components/charts/Charts";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { RecordPanel } from "@/components/ui/RecordPanel";
import { StudentAvatar } from "@/components/ui/StudentAvatar";
import { Alert } from "@/components/ui/Alert";
import { SemesterResultsPicker, SemesterResultsTable } from "@/components/grades/SemesterResults";
import { buttonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ClipboardList, Printer } from "lucide-react";

export const metadata: Metadata = { title: "Home" };

const FACT_CHIP = {
  brand: "bg-brand-subtle-strong text-brand-fg",
  accent: "bg-accent-soft text-accent-soft-fg",
  info: "bg-info-surface text-info-fg",
  success: "bg-success-surface text-success-fg",
} as const;


/**
 * One fact about the student, as its own card with a tinted glyph -- the
 * row of four across the top of the design reference's profile screen.
 *
 * Still a definition list inside. These are term/value pairs and were
 * marked up as one before; splitting them across four cards is a visual
 * change, and it should not quietly cost the semantics.
 */
function FactCard({
  icon,
  tone,
  term,
  value,
}: {
  icon: React.ReactNode;
  tone: keyof typeof FACT_CHIP;
  term: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-line bg-surface flex items-start gap-3 rounded-2xl border p-4 shadow-[0_1px_2px_rgb(16_12_32_/_0.04),0_8px_24px_-12px_rgb(16_12_32_/_0.12)]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${FACT_CHIP[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <dl className="min-w-0">
        <dt className="text-fg-muted text-xs font-semibold tracking-wide uppercase">{term}</dt>
        <dd className="text-fg mt-1 text-sm font-bold">{value}</dd>
      </dl>
    </div>
  );
}

/** Icon-only action button -- same shape, hover and focus ring as the
 *  Students and Offerings tables, with a title and an accessible name so the
 *  icon is never the only thing carrying the meaning. */
/** The dashboard subtitle, shared by all three role homes. */
const WELCOME_TEXT = "Here\u2019s what\u2019s happening at Liberia Christian College.";

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
    // pickCurrentSemester rather than a sort written out here, so that the
    // planning page this card links to resolves the same row: two
    // semesters may share a start date, and two independent picks over the
    // same tie is exactly how the status line below came to describe one
    // semester while the button beside it opened another.
    const photoMeta = await getStudentPhotoMeta(actor, record.id);

    const currentSemester = pickCurrentSemester(semesters);
    const currentSemesterLabel = currentSemester ? semesterInfo(currentSemester.id)?.label : null;

    // S-03's "single status line if a course plan needs attention" --
    // only fetched when there is a current semester to have a plan in.
    const currentPlan = currentSemester ? await getMyPlan(actor, currentSemester.id) : null;
    // Only when a plan exists, so a student with none pays for nothing.
    const currentPlanItems = currentPlan ? await getPlanItems(actor, currentPlan.id) : [];

    // This semester's timetable, for the card under the academic record.
    // Only the courses that are actually approved and registered -- a
    // pending one is not yet a class the student turns up to. Fetched only
    // when there is at least one, so a student with no plan pays nothing.
    const registeredItems = currentPlanItems.filter((i) => i.status === "APPROVED");
    const registeredOfferingIds = registeredItems.map((i) => i.offeringId);
    const [registeredOfferings, registeredMeetings, planCourses_] = registeredOfferingIds.length
      ? await Promise.all([
          getOfferingsByIds(actor, registeredOfferingIds),
          getOfferingMeetingsForOfferings(actor, registeredOfferingIds),
          asUser(actor.userId, (tx) => tx.query.course.findMany()),
        ])
      : [[], new Map(), []];
    const offeringById = new Map(registeredOfferings.map((o) => [o.id, o]));
    const courseById = new Map(planCourses_.map((c) => [c.id, c]));

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
    // EVERY plan state says something now. Three of them used to fall
    // through to null and show nothing at all: a student with an unsubmitted
    // DRAFT got no reminder and could miss registration entirely without the
    // app ever mentioning it, and a student whose plan was APPROVED got no
    // confirmation that they were registered. Silence is the wrong answer in
    // both directions.
    // Counted from the plan items actually read back, never from a status
    // word alone: course_plan.total_credits is a snapshot written at submit
    // and again at approval, so it can outlive the rows it was counted
    // from. Anything this line claims, the student can go and see.
    const planCourses = currentPlanItems.length;
    const approvedCourses = currentPlanItems.filter((i) => i.status === "APPROVED").length;
    const rejectedCourses = currentPlanItems.filter((i) => i.status === "REJECTED").length;
    const noun = (n: number) => (n === 1 ? "course" : "courses");
    const planStatus: { tone: "warning" | "info" | "success"; line: string } | null =
      isPlanningOpen(currentSemester?.state as SemesterState) && !currentPlan
        ? { tone: "warning", line: "You have not started your course plan for this semester." }
        : currentPlan?.status === "DRAFT"
          ? {
              tone: "warning",
              line: planCourses
                ? `Your course plan is still a draft — ${planCourses} ${noun(planCourses)} added, not yet submitted.`
                : "Your course plan is still a draft and has no courses in it yet.",
            }
          : currentPlan?.status === "REJECTED"
            ? { tone: "warning", line: "Your course plan was returned and needs revision." }
            : currentPlan?.status === "SUBMITTED"
              ? {
                  tone: "info",
                  line: planCourses
                    ? `Your course plan is awaiting approval — ${planCourses} ${noun(planCourses)} submitted.`
                    : // A submitted plan with nothing in it is not a state the
                      // app can produce, so saying "awaiting approval" here
                      // would send the student to an empty page wondering
                      // which courses were meant. Name what is actually
                      // there instead.
                      "Your course plan was submitted, but it has no courses in it. Please contact the Admin office.",
                }
              : currentPlan?.status === "APPROVED"
                ? {
                    tone: "success",
                    line: approvedCourses
                      ? `Your course plan is approved — ${approvedCourses} ${noun(approvedCourses)} registered.`
                      : "Your course plan is approved.",
                  }
                : currentPlan?.status === "PARTIALLY_APPROVED"
                  ? {
                      tone: "warning",
                      line:
                        approvedCourses || rejectedCourses
                          ? `${approvedCourses} ${noun(approvedCourses)} approved and registered; ${rejectedCourses} turned down.`
                          : "Some of your courses were approved and registered; others were turned down.",
                    }
                  : null;

    // What the button does depends on what the plan is, not on one status
    // being singled out: every state that is read-only says "view", every
    // state the student still has work in says what that work is.
    const planActionLabel = !currentPlan
      ? "Plan my courses"
      : currentPlan.status === "DRAFT"
        ? planCourses
          ? "Continue my plan"
          : "Plan my courses"
        : currentPlan.status === "REJECTED"
          ? "Revise my plan"
          : currentPlan.status === "PARTIALLY_APPROVED"
            ? "Review my plan"
            : "View my courses";
    // Carrying the semester is the whole point: the planning page picks its
    // own default otherwise, and with more than one semester OPEN that
    // default is not necessarily the semester this line is about.
    const planHref = currentSemester ? `/planning?semesterId=${currentSemester.id}` : "/planning";

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
        <Breadcrumb items={[{ label: "Student profile" }]} />
        {/* The photograph appears HERE and nowhere else in the app. Not in
            the Student Listing, not in the plan-review queue, not in any
            table: a column of faces makes a dense table slower to scan, and
            those tables are how the office actually works. This is the one
            screen that is about a person rather than about their records.
            Uploading is the Admin office's job -- there is no control here,
            only the result. */}
        <div className="mb-6 flex items-start gap-5 print:hidden">
          <StudentAvatar
            studentId={record.id}
            name={fullName(record)}
            hasPhoto={!!photoMeta}
            version={photoMeta?.uploadedAt.getTime()}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <PageHeader
              className="mb-0"
              title={
                <span className="inline-flex flex-wrap items-center gap-3">
                  {fullName(record)}
                  <Badge tone={record.status === "ACTIVE" ? "success" : "neutral"}>{record.status}</Badge>
                </span>
              }
              description={`Student ID ${record.studentNumber}`}
              actions={
                <p className="text-brand-fg border-accent hidden border-b-2 pb-1 text-sm font-semibold italic sm:block">
                  Building Character &middot; Shaping Tomorrow
                </p>
              }
            />
          </div>
        </div>

        {/* The same four facts the definition list carried, one card each
            as the design reference lays them out. Still a <dl> inside each:
            these are term/value pairs and the markup should keep saying so. */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FactCard icon={<School className="h-5 w-5" />} tone="brand" term="Department" value={department ? department.name : "—"} />
          <FactCard icon={<CalendarDays className="h-5 w-5" />} tone="accent" term="Enrolment year" value={record.enrolmentYear} />
          <FactCard
            icon={<GraduationCap className="h-5 w-5" />}
            tone="info"
            term="Current semester"
            value={
              currentSemesterLabel
                ? `${currentSemesterLabel} (${SEMESTER_STATE_LABEL[currentSemester!.state as SemesterState] ?? currentSemester!.state})`
                : "No semester is currently open."
            }
          />
          <FactCard icon={<UserCheck className="h-5 w-5" />} tone="success" term="Status" value={record.status} />
        </div>

        {/* Guidance for the screen, not part of the record: a printed copy
            of a semester's results should not carry a note about a course
            plan for a different, later semester. */}
        {planStatus && (
          <Alert tone={planStatus.tone} className="mb-6 print:hidden">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>{planStatus.line}</span>
              <Link href={planHref} className={buttonClasses("secondary", "sm", "shrink-0")}>
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                {planActionLabel}
              </Link>
            </span>
          </Alert>
        )}

        {/* Academic record and the semester results sit side by side from
            xl up, as the design reference pairs them. Below that they stack,
            because the results table needs the full width long before the
            record panel does. */}
        {/* min-w-0 on the children, not decoration: a grid item defaults to
            min-width:auto, so a Table's own overflow-x-auto cannot contain
            it and the whole page scrolls sideways instead. At 390px this
            made the document 572px wide and left the top bar ending
            mid-screen. */}
        <div className="mb-6 grid items-start gap-4 xl:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle icon={<Award className="h-4 w-4" aria-hidden="true" />}>Academic record</CardTitle>
          </CardHeader>
          <CardBody>
            {isProvisional && (
              <Alert tone="warning" className="mb-4 text-xs">
                Provisional -- based on records entered so far. Your academic history is still being entered by the
                Admin office.
              </Alert>
            )}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RecordPanel icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />} term="CGPA" emphasis>
                {cumulative?.cgpa ?? "—"}
              </RecordPanel>
              <RecordPanel icon={<Award className="h-4 w-4" aria-hidden="true" />} term="Academic standing">
                {cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}
              </RecordPanel>
              <RecordPanel icon={<BookOpen className="h-4 w-4" aria-hidden="true" />} term="Credits earned">
                {cumulative ? `${cumulative.totalCreditsEarned} of 132 — ${cumulative.creditsToGraduation} remaining` : "—"}
              </RecordPanel>
              <RecordPanel icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />} term="Credits attempted">
                {cumulative?.totalCreditsAttempted ?? "—"}
              </RecordPanel>
            </dl>
          </CardBody>
        </Card>

        {/* What the student is actually registered for this semester.
            The left column ran out of content well before the results
            table beside it did, leaving a column of empty page under the
            record card. This is the obvious thing to put there: it is
            about the semester the status line above is about, it is real
            data already half-fetched for that line, and it answers "what
            am I taking" without a trip to the planning screen. */}
        {registeredItems.length > 0 && (
          <Card className="min-w-0">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}>This semester</CardTitle>
              <span className="text-fg-muted text-sm">
                {registeredItems.length} {registeredItems.length === 1 ? "course" : "courses"}
              </span>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-col gap-2">
                {registeredItems.map((i) => {
                  const offering = offeringById.get(i.offeringId);
                  const course = courseById.get(i.courseId);
                  const when = formatMeetingSlots(registeredMeetings.get(i.offeringId) ?? []);
                  const detail = [...when, offering ? `${offering.frozenCreditHours} credit hours` : null].filter(
                    (x): x is string => !!x,
                  );
                  return (
                    <li key={i.id} className="border-line-subtle bg-surface-subtle rounded-xl border px-3 py-2.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="bg-brand-subtle text-brand-fg rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold">
                          {course?.code ?? "—"}
                        </span>
                        <span className="text-fg min-w-0 text-sm font-semibold">{course?.title ?? i.courseId}</span>
                      </span>
                      {/* Only when there is something to say. A student
                          reads offerings through RLS, which shows them only
                          PUBLISHED ones -- so a course whose offering was
                          later cancelled has no meeting times to show them,
                          and an empty line under the title looks like a
                          rendering fault rather than an absence. */}
                      {detail.length > 0 && <span className="text-fg-muted mt-1 block text-xs">{detail.join(" \u00b7 ")}</span>}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        )}
        </div>

        {obligations.length > 0 && (
          <Card className="mb-6 min-w-0 border-warning-line bg-warning-surface xl:col-span-5">
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

        <Card className="min-w-0 xl:col-span-3">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle icon={<PieChart className="h-4 w-4" aria-hidden="true" />}>Semester results</CardTitle>
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
            <SemesterResultsPicker
              years={resultYearIds.map((id) => ({ id, label: yearLabelFor(id) }))}
              semesters={yearSemesterIds.map((id) => {
                const sem = semesters.find((x) => x.id === id);
                return { id, label: sem ? semesterDisplayName(sem) : id };
              })}
              selectedYearId={selectedYearId}
              selectedSemesterId={selectedSemesterId}
            />
          )}

          <CardBody>
            {!sheet && <p className="text-sm text-fg-muted">No results yet.</p>}
            {sheet && (
              <SemesterResultsTable
                sheet={sheet}
                label={selectedInfo?.label ?? selectedSemesterId ?? ""}
                sortKey={selectedInfo?.sortKey}
                isProvisional={selectedSummary?.isProvisional}
              />
            )}
          </CardBody>
        </Card>
        </div>
      </main>
    );
  }

  if (actor.role === "SUPER_ADMIN") {
    // The queues and the statistics share nothing, so they are fetched
    // together rather than one after the other.
    const [summary, stats] = await Promise.all([getSuperAdminHomeSummary(actor), getStudentStatistics(actor)]);
    const nothingWaiting = summary.submissionsAwaitingApproval === 0 && summary.correctionsAwaitingDecision === 0;

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
        <Breadcrumb items={[{ label: "Dashboard" }]} />
        <PageHeader eyebrow="Overview" title={`Welcome back, ${actor.displayName}!`} description={WELCOME_TEXT} />

        <StatisticsSection stats={stats} semesterCount={summary.semesterStates.length} />

        <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}>Awaiting your approval</CardTitle>
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
            <CardTitle icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}>Semester states</CardTitle>
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
        </div>
      </main>
    );
  }

  // ADMIN
  const [summary, stats] = await Promise.all([getAdminHomeSummary(actor), getStudentStatistics(actor)]);
  const nothingWaiting =
    summary.plansAwaitingApproval === 0 && summary.classesNotYetSubmitted === 0 && summary.rejectedGradesNeedingRework === 0;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <Breadcrumb items={[{ label: "Dashboard" }]} />
      <PageHeader eyebrow="Overview" title={`Welcome back, ${actor.displayName}!`} description={WELCOME_TEXT} />

      <StatisticsSection stats={stats} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}>Work queues</CardTitle>
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
          <CardTitle icon={<History className="h-4 w-4" aria-hidden="true" />}>Historical import</CardTitle>
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
      </div>
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
        <StatTile
          label="Total students"
          value={stats.total}
          hint="Across every enrolment year"
          icon={<Users className="h-5 w-5" />}
          tone="brand"
        />
        <StatTile
          label="Active"
          value={stats.byStatus.find((s) => s.label === "ACTIVE")?.count ?? 0}
          hint={
            stats.total > 0
              ? `${Math.round(((stats.byStatus.find((s) => s.label === "ACTIVE")?.count ?? 0) / stats.total) * 100)}% currently enrolled`
              : "Currently enrolled"
          }
          icon={<UserCheck className="h-5 w-5" />}
          tone="success"
        />
        <StatTile
          label="Colleges represented"
          value={stats.byCollege.length}
          hint="With at least one student"
          icon={<Building2 className="h-5 w-5" />}
          tone="info"
        />
        <StatTile
          label={semesterCount === undefined ? "Enrolment years" : "Semesters"}
          value={semesterCount ?? stats.byEnrolmentYear.length}
          hint={semesterCount === undefined ? "Represented in the roll" : "On the academic calendar"}
          icon={<CalendarDays className="h-5 w-5" />}
          tone="accent"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle icon={<PieChart className="h-4 w-4" aria-hidden="true" />}>Students by status</CardTitle>
          </CardHeader>
          <CardBody>
            <StatusBarList data={stats.byStatus} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={<Users className="h-4 w-4" aria-hidden="true" />}>Students by gender</CardTitle>
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

      {/* College and enrolment year share a row, as the design reference
          pairs them -- but not evenly. College names run long ("CHS --
          College of Health Sciences"), so it takes three fifths and the
          year columns take two, rather than both wrapping at a half. */}
      <div className="mb-6 grid items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle icon={<School className="h-4 w-4" aria-hidden="true" />}>Students by college</CardTitle>
          </CardHeader>
          <CardBody>
            <BarList data={stats.byCollege} emptyMessage="No students are enrolled in any college yet." />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}>Students by enrolment year</CardTitle>
          </CardHeader>
          <CardBody>
            <ColumnChart data={stats.byEnrolmentYear} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
