import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, GraduationCap, PieChart, Printer, TrendingUp } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { semesterDisplayName, semesterFullLabel } from "@/lib/academic/semesterName";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getStudentHistory } from "@/lib/historical/historical";
import { getGradeSheet, trimCredits } from "@/lib/gradesheet/gradeSheet";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { RecordPanel } from "@/components/ui/RecordPanel";
import { Alert } from "@/components/ui/Alert";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { SemesterResultsPicker, SemesterResultsTable } from "@/components/grades/SemesterResults";

export const metadata: Metadata = { title: "My grades" };

const iconAction =
  "inline-flex rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * A screen for grades and nothing else.
 *
 * The student profile (/portal) has carried one semester's results since
 * Stage 5, but it carries them alongside the enrolment record and the
 * course-plan status, and there was no way to reach grades from the
 * navigation at all. This page is the one the Grades menu item opens.
 *
 * It adds exactly one view the profile does not have -- every semester's
 * GPA in one table -- and that is assembled from `student_semester_summary`
 * rows that already exist. Everything else here is the same data out of the
 * same services: the cumulative figures, the outstanding repeats, and the
 * chosen semester's results out of getGradeSheet(), which is also what the
 * printed sheet is built from. Screen and paper cannot disagree.
 *
 * Scoped to the signed-in student's own id throughout. There is no
 * studentId in this route, and every read goes through asUser() so
 * row-level security is the boundary underneath the service layer.
 */
export default async function MyGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; semesterId?: string }>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  if (actor.role !== "STUDENT") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  // One round trip for the two reference lists, then the student's own
  // figures -- none of these depend on each other.
  const [semesters, academicYears] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany()]),
  );
  const [history, cumulative, semesterSummaries, obligations] = await Promise.all([
    getStudentHistory(actor, actor.userId),
    getCumulativeSummary(actor, actor.userId),
    getSemesterSummaries(actor, actor.userId),
    getOutstandingRepeatObligations(actor, actor.userId),
  ]);

  const semesterInfo = (semesterId: string) => {
    const sem = semesters.find((s) => s.id === semesterId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year
      ? {
          label: semesterFullLabel(year, sem),
          shortLabel: semesterDisplayName(sem),
          yearLabel: year.label,
          sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 },
        }
      : null;
  };

  // Only semesters this student actually has results in, newest first --
  // the same rule the profile uses, so the two screens offer the same list.
  const resultSemesterIds = [...new Set(history.map((r) => r.semesterId))].sort((a, b) => {
    const ka = semesterInfo(a)?.sortKey;
    const kb = semesterInfo(b)?.sortKey;
    if (!ka || !kb) return 0;
    return kb.yearStart - ka.yearStart || kb.sequence - ka.sequence;
  });
  const yearIdFor = (semesterId: string) => semesters.find((s) => s.id === semesterId)?.academicYearId;
  const yearLabelFor = (yearId: string) => academicYears.find((y) => y.id === yearId)?.label ?? yearId;
  const resultYearIds = [...new Set(resultSemesterIds.map(yearIdFor).filter((id): id is string => !!id))];

  const { year: requestedYearId, semesterId: requestedSemesterId } = await searchParams;
  const selectedYearId = requestedYearId && resultYearIds.includes(requestedYearId) ? requestedYearId : resultYearIds[0];
  const yearSemesterIds = resultSemesterIds.filter((id) => yearIdFor(id) === selectedYearId);
  const selectedSemesterId =
    requestedSemesterId && yearSemesterIds.includes(requestedSemesterId) ? requestedSemesterId : yearSemesterIds[0];

  const sheet = selectedSemesterId ? await getGradeSheet(actor, actor.userId, selectedSemesterId) : null;
  const selectedInfo = selectedSemesterId ? semesterInfo(selectedSemesterId) : null;
  const summaryFor = (semesterId: string) => semesterSummaries.find((s) => s.semesterId === semesterId);
  const isProvisional = cumulative?.isProvisional ?? false;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8">
      <Breadcrumb items={[{ label: "My grades" }]} />
      <PageHeader
        title="My grades"
        description="Your results semester by semester, and the cumulative figures they add up to."
      />

      {resultSemesterIds.length === 0 && (
        <Alert tone="info">
          No results have been published for you yet. Grades appear here once the Admin office has approved them.
        </Alert>
      )}

      {resultSemesterIds.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle icon={<Award className="h-4 w-4" aria-hidden="true" />}>Cumulative record</CardTitle>
              </CardHeader>
              <CardBody>
                {isProvisional && (
                  <Alert tone="warning" className="mb-4 text-xs">
                    Provisional -- based on records entered so far. Your academic history is still being entered by the Admin
                    office.
                  </Alert>
                )}
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <RecordPanel icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />} term="CGPA" emphasis>
                    {cumulative?.cgpa ?? "—"}
                  </RecordPanel>
                  <RecordPanel icon={<Award className="h-4 w-4" aria-hidden="true" />} term="Academic standing">
                    {cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}
                  </RecordPanel>
                </dl>

                {/* Degree progress as three plain numbers that add up, rather
                    than "earned" beside "attempted" -- two figures that are
                    equal for every student who has not failed anything, so
                    the pair looked like the same fact printed twice. The
                    total comes from the GPA policy, not a literal here, so
                    it cannot drift from what the engine graduates on.

                    Attempted has NOT been dropped, only moved: it is the
                    denominator behind the CGPA above and it differs from
                    earned exactly when a course was failed, so it belongs
                    with the figure it explains rather than in a progress
                    row. It shows below when the two disagree. */}
                {cumulative && (
                  <div className="border-line-subtle mt-3 rounded-xl border p-1">
                    <dl className="grid grid-cols-3 divide-x divide-line-subtle">
                      <ProgressFigure term="Total credits" value={cumulative.graduationCreditHours} />
                      <ProgressFigure term="Completed" value={trimCredits(cumulative.totalCreditsEarned)} tone="brand" />
                      <ProgressFigure term="Remaining" value={trimCredits(cumulative.creditsToGraduation)} />
                    </dl>
                  </div>
                )}

                {cumulative && cumulative.totalCreditsAttempted !== cumulative.totalCreditsEarned && (
                  <p className="text-fg-muted mt-3 text-xs">
                    {trimCredits(cumulative.totalCreditsAttempted)} credit hours attempted \u2014 the difference is coursework
                    that did not earn credit.
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Every semester at once. The profile shows one at a time, and
                "how have I done overall" is the question this page exists
                to answer. Straight out of student_semester_summary -- the
                same rows the semester GPA under the results table is read
                from, so the two cannot disagree. */}
            <Card>
              <CardHeader>
                <CardTitle icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}>Semester by semester</CardTitle>
              </CardHeader>
              <CardBody>
                <Table>
                  <Thead>
                    <tr>
                      <Th>Semester</Th>
                      <Th className="text-center">Attempted</Th>
                      <Th className="text-center">Earned</Th>
                      <Th className="text-center">GPA</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {resultSemesterIds.map((id, i) => {
                      const info = semesterInfo(id);
                      const summary = summaryFor(id);
                      return (
                        <Tr key={id} className={i % 2 === 1 ? "bg-brand-subtle" : undefined}>
                          <Td>{info?.label ?? id}</Td>
                          <Td className="text-center">{summary ? trimCredits(summary.creditsAttempted) : "—"}</Td>
                          <Td className="text-center">{summary ? trimCredits(summary.creditsEarned) : "—"}</Td>
                          <Td className="text-center font-semibold">
                            {summary?.gpa ?? "—"}
                            {summary?.isProvisional && (
                              <span className="ml-1 text-xs font-normal text-fg-muted">(provisional)</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </CardBody>
            </Card>

            {obligations.length > 0 && (
              <Card className="border-warning-line bg-warning-surface">
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
          </div>

          <Card className="min-w-0 xl:col-span-3">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle icon={<PieChart className="h-4 w-4" aria-hidden="true" />}>Semester results</CardTitle>
              {/* One control, not a Print beside a Download: both would open
                  the same dialog, and what separates printing from saving
                  happens inside it, on a Destination menu no page is allowed
                  to preset. It opens the College's own grade sheet for the
                  chosen semester -- the letterhead document, A4 landscape,
                  the same one the Registrar prints. */}
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

            <SemesterResultsPicker
              years={resultYearIds.map((id) => ({ id, label: yearLabelFor(id) }))}
              semesters={yearSemesterIds.map((id) => ({ id, label: semesterInfo(id)?.shortLabel ?? id }))}
              selectedYearId={selectedYearId}
              selectedSemesterId={selectedSemesterId}
            />

            <CardBody>
              {!sheet && <p className="text-sm text-fg-muted">No results yet.</p>}
              {sheet && (
                <SemesterResultsTable
                  sheet={sheet}
                  label={selectedInfo?.label ?? selectedSemesterId ?? ""}
                  sortKey={selectedInfo?.sortKey}
                  isProvisional={selectedSemesterId ? summaryFor(selectedSemesterId)?.isProvisional : undefined}
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </main>
  );
}

/** One of the three degree-progress figures. Deliberately plainer than
 *  RecordPanel: these read as a single sentence across, so each needs a
 *  number and a word, not a bordered tile of its own. */
function ProgressFigure({ term, value, tone }: { term: string; value: string | number; tone?: "brand" }) {
  return (
    <div className="px-3 py-2 text-center">
      <dt className="text-fg-muted text-[11px] font-semibold tracking-wide uppercase">{term}</dt>
      <dd className={tone === "brand" ? "text-brand-fg mt-0.5 text-xl font-extrabold" : "text-fg mt-0.5 text-xl font-bold"}>
        {value}
      </dd>
    </div>
  );
}
