import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Eye, FilePen, GraduationCap, Printer, UserRound } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterDisplayName, semesterFullLabel } from "@/lib/academic/semesterName";
import { asUser } from "@/lib/db/asUser";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { getStudent, searchStudents } from "@/lib/students/students";
import { fullName, listName } from "@/lib/students/name";
import { getStudentHistory } from "@/lib/historical/historical";
import { getRegistrationsForStudent } from "@/lib/planning/planning";
import { getStudentGradesForSemester, type StudentGradeRow } from "@/lib/grades/grades";
import { getCumulativeSummary, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getGradeSheet, trimCredits } from "@/lib/gradesheet/gradeSheet";
import { SemesterResultsPicker, SemesterResultsTable } from "@/components/grades/SemesterResults";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { requestCorrectionFromStudentGradesAction } from "./actions";

export const metadata: Metadata = { title: "Student grades" };

const PAGE_SIZE = 10;

/**
 * Student grades: one screen that goes straight from "which student" to
 * "this is their result in this course, and here is how to change it".
 *
 * The route that existed before ran Student Listing -> student profile ->
 * scroll past enrolment details, guardians and course plans -> results.
 * Three screens and a scroll to reach the thing the registrar's office
 * looks at most days. This page is the same data with nothing else on it.
 *
 * Deliberately NOT a second way to write a grade. Entering grades for a
 * class is /admin/grades and changing a published one is a two-key
 * correction (Section 15.5, REQ-G08): an Admin proposes, a Super Admin
 * decides. That rule is not this screen's to relax, so the "change"
 * control here opens a correction request against the very same service
 * function /admin/grade-corrections calls. What this page adds is that the
 * request can be made from the student's own record, where the mistake is
 * actually noticed, instead of by reconstructing the class it came from.
 */
export default async function StudentGradesPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    semesterId?: string;
    year?: string;
    sq?: string;
    sp?: string;
    error?: string;
    requested?: string;
  }>;
}) {
  const actor = await getCurrentActor();
  const { studentId, semesterId, year, sq, sp, error, requested } = await searchParams;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  let chosen: Awaited<ReturnType<typeof getStudent>> | undefined;
  if (studentId) {
    try {
      chosen = await getStudent(actor, studentId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      return (
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
          <Alert tone="info">Student not found.</Alert>
        </main>
      );
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        title="Student grades"
        description="Look a student up and see their results semester by semester — with the grade sheet to print and, where the rules allow it, the way to correct a grade."
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {requested && !error && (
        <Alert tone="success" className="mb-4">
          Correction requested. It now waits for a Super Admin to decide it —{" "}
          <Link href="/admin/grade-corrections" className="font-medium underline">
            Grade corrections
          </Link>{" "}
          shows where it has got to.
        </Alert>
      )}

      {!chosen ? (
        <StudentPicker actor={actor} sq={sq} sp={sp} />
      ) : (
        <StudentGrades actor={actor} student={chosen} year={year} semesterId={semesterId} sq={sq} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Step one: which student
// ---------------------------------------------------------------------------

/** The listing is on screen from the first load rather than waiting for a
 *  search, so the common case -- a student standing at the counter whose
 *  name you are already typing, and the twenty-odd you looked at this
 *  morning -- both work without a second click. */
async function StudentPicker({ actor, sq, sp }: { actor: Actor; sq?: string; sp?: string }) {
  const pageNum = Math.max(1, Number(sp) || 1);
  const results = await searchStudents(actor, { query: sq?.trim() || undefined, page: pageNum, pageSize: PAGE_SIZE });
  const departments = results.rows.length ? await asUser(actor.userId, (tx) => tx.query.department.findMany()) : [];
  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";

  const pageHref = (p: number) =>
    `/admin/student-grades?${new URLSearchParams({ ...(sq ? { sq } : {}), ...(p > 1 ? { sp: String(p) } : {}) }).toString()}`;

  const lastPage = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const firstOnPage = results.total === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const lastOnPage = (pageNum - 1) * PAGE_SIZE + results.rows.length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle icon={<UserRound className="h-4 w-4" aria-hidden="true" />}>Choose a student</CardTitle>
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <Label htmlFor="sq" className="sr-only">
            Search students
          </Label>
          {/* The width lives on a wrapper, not on the Input: `fieldBase`
              already carries `w-full` and `cn` is a plain joiner with no
              tailwind-merge, so a `w-56` passed in here would lose. */}
          <div className="w-56">
            <Input id="sq" name="sq" defaultValue={sq ?? ""} placeholder="Student ID or name" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {sq && (
            <Link href="/admin/student-grades" className="text-xs font-medium text-brand-fg hover:underline">
              Clear
            </Link>
          )}
        </form>
      </CardHeader>
      <CardBody>
        {results.rows.length === 0 ? (
          <p className="text-sm text-fg-muted">{sq ? <>No students match &ldquo;{sq}&rdquo;.</> : "No students on record yet."}</p>
        ) : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th className="whitespace-nowrap">Student ID</Th>
                  <Th>Name</Th>
                  <Th className="hidden sm:table-cell">Department</Th>
                  {/* Below sm the row is Student ID, name and the action --
                      the status pill is the first thing to go, because a
                      clipped action button is worse than a missing badge. */}
                  <Th className="hidden whitespace-nowrap sm:table-cell">Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </Thead>
              <tbody>
                {results.rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{s.studentNumber}</Td>
                    <Td className="font-medium text-fg">{listName(s)}</Td>
                    <Td className="hidden text-fg-secondary sm:table-cell">{departmentName(s.departmentId)}</Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">
                      <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status}</Badge>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/admin/student-grades?studentId=${s.id}${sq ? `&sq=${encodeURIComponent(sq)}` : ""}`}
                        className={buttonClasses("primary", "sm", "gap-1.5")}
                        aria-label={`View grades — ${listName(s)}`}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        View grades
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">
                Showing {firstOnPage}–{lastOnPage} of {results.total} student{results.total === 1 ? "" : "s"}
                {sq && <> matching &ldquo;{sq}&rdquo;</>}
              </p>
              {lastPage > 1 && (
                <div className="flex items-center gap-2">
                  {pageNum > 1 && (
                    <Link href={pageHref(pageNum - 1)} className={buttonClasses("secondary", "sm")}>
                      Previous
                    </Link>
                  )}
                  <span className="text-xs text-fg-muted">
                    Page {pageNum} of {lastPage}
                  </span>
                  {pageNum < lastPage && (
                    <Link href={pageHref(pageNum + 1)} className={buttonClasses("secondary", "sm")}>
                      Next
                    </Link>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step two: that student's grades
// ---------------------------------------------------------------------------

const GRADE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  PUBLISHED: "success",
  LOCKED: "brand",
};

const GRADE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting review",
  PUBLISHED: "Published",
  LOCKED: "Locked",
};

async function StudentGrades({
  actor,
  student,
  year,
  semesterId,
  sq,
}: {
  actor: Actor;
  student: NonNullable<Awaited<ReturnType<typeof getStudent>>>;
  year?: string;
  semesterId?: string;
  sq?: string;
}) {
  const [semesters, academicYears, departments] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany(), tx.query.department.findMany()]),
  );
  const [history, registrations, summaries, cumulative] = await Promise.all([
    getStudentHistory(actor, student.id),
    getRegistrationsForStudent(actor, student.id),
    getSemesterSummaries(actor, student.id),
    getCumulativeSummary(actor, student.id),
  ]);

  const sortKeyOf = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const yr = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && yr ? { yearStart: new Date(yr.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 } : null;
  };

  // Every semester this student has anything in: published history, and
  // also the ones they are merely registered for, because a grade that is
  // still in draft or awaiting review is exactly the kind this screen is
  // asked about.
  const semesterIds = [...new Set([...history.map((r) => r.semesterId), ...registrations.map((r) => r.semesterId)])].sort((a, b) => {
    const ka = sortKeyOf(a);
    const kb = sortKeyOf(b);
    if (!ka || !kb) return 0;
    return kb.yearStart - ka.yearStart || kb.sequence - ka.sequence;
  });

  const yearIdOf = (semId: string) => semesters.find((s) => s.id === semId)?.academicYearId;
  const yearIds = [...new Set(semesterIds.map(yearIdOf).filter((id): id is string => !!id))];

  // Land on the newest semester that actually HAS results, not simply the
  // newest one. The current term is usually the newest and usually has
  // nothing recorded yet, so defaulting to it opened this page on an empty
  // table for almost every student.
  const withResults = new Set(history.map((r) => r.semesterId));
  const defaultSemesterId = semesterIds.find((id) => withResults.has(id)) ?? semesterIds[0];
  const defaultYearId = defaultSemesterId ? yearIdOf(defaultSemesterId) : undefined;
  const selectedYearId = year && yearIds.includes(year) ? year : (defaultYearId ?? yearIds[0]);
  const yearSemesterIds = semesterIds.filter((id) => yearIdOf(id) === selectedYearId);
  const selectedSemesterId =
    semesterId && yearSemesterIds.includes(semesterId)
      ? semesterId
      : defaultSemesterId && yearSemesterIds.includes(defaultSemesterId)
        ? defaultSemesterId
        : yearSemesterIds[0];

  const sheet = selectedSemesterId ? await getGradeSheet(actor, student.id, selectedSemesterId) : null;
  const gradeRows = selectedSemesterId ? await getStudentGradesForSemester(actor, student.id, selectedSemesterId) : [];
  const selectedSemester = semesters.find((s) => s.id === selectedSemesterId);
  const selectedYear = academicYears.find((y) => y.id === selectedYearId);
  const semesterLabel = selectedSemesterId ? semesterFullLabel(selectedYear, selectedSemester, selectedSemesterId) : "";
  const summary = summaries.find((s) => s.semesterId === selectedSemesterId);
  const departmentName = departments.find((d) => d.id === student.departmentId)?.name ?? "—";

  const backHref = `/admin/student-grades${sq ? `?sq=${encodeURIComponent(sq)}` : ""}`;

  return (
    <>
      {/* Who this is, what they stand at, and the two things you leave this
          page for: the printed sheet and the full profile. */}
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center gap-4">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-subtle-strong text-sm font-bold text-brand-fg"
            aria-hidden="true"
          >
            {initials(student)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-fg">{fullName(student)}</p>
            <p className="text-xs text-fg-muted">
              <span className="font-mono">{student.studentNumber}</span> &middot; {departmentName} &middot; {student.status}
            </p>
          </div>
          <dl className="flex items-center gap-5">
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">CGPA</dt>
              <dd className="text-sm font-bold text-fg">{cumulative?.cgpa ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Credits earned</dt>
              <dd className="text-sm font-bold text-fg">
                {cumulative ? trimCredits(cumulative.totalCreditsEarned) : "—"}
              </dd>
            </div>
            {summary?.gpa && (
              <div>
                <dt className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">Semester GPA</dt>
                <dd className="text-sm font-bold text-fg">{summary.gpa}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {selectedSemesterId && (
              <Link
                href={`/admin/students/${student.id}/grade-sheet/${selectedSemesterId}`}
                className={buttonClasses("primary", "sm", "gap-1.5")}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Print grade sheet
              </Link>
            )}
            <Link href={`/admin/students/${student.id}`} className={buttonClasses("secondary", "sm", "gap-1.5")}>
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              Full profile
            </Link>
            <Link href={backHref} className={buttonClasses("ghost", "sm", "gap-1.5")}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Another student
            </Link>
          </div>
        </CardBody>
      </Card>

      {semesterIds.length === 0 ? (
        <Alert tone="info">
          {fullName(student)} has no registrations and no results on record, so there is nothing to show here yet.
        </Alert>
      ) : (
        <>
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}>Results</CardTitle>
            </CardHeader>
            <SemesterResultsPicker
              years={yearIds.map((id) => ({ id, label: academicYears.find((y) => y.id === id)?.label ?? id }))}
              semesters={yearSemesterIds.map((id) => ({
                id,
                label: semesters.find((s) => s.id === id) ? semesterDisplayName(semesters.find((s) => s.id === id)!) : id,
              }))}
              selectedYearId={selectedYearId}
              selectedSemesterId={selectedSemesterId}
              hiddenFields={{ studentId: student.id, ...(sq ? { sq } : {}) }}
            />
            <CardBody>
              {sheet && selectedSemesterId ? (
                <SemesterResultsTable
                  sheet={sheet}
                  label={semesterLabel}
                  sortKey={sortKeyOf(selectedSemesterId) ?? undefined}
                  isProvisional={summary?.isProvisional}
                />
              ) : (
                <p className="text-sm text-fg-muted">Choose a semester to see this student&rsquo;s results.</p>
              )}
            </CardBody>
          </Card>

          <GradeChangeCard rows={gradeRows} semesterLabel={semesterLabel} studentId={student.id} sq={sq} />
        </>
      )}
    </>
  );
}

/**
 * The grades as records rather than as a sheet: each one with the stage it
 * has reached and, for the published and locked ones, the way to propose a
 * change.
 *
 * A grade still in DRAFT or awaiting review is not corrected -- it is
 * simply re-entered on the class screen, which is what the row says
 * instead of offering a control that would be refused.
 */
function GradeChangeCard({
  rows,
  semesterLabel,
  studentId,
  sq,
}: {
  rows: StudentGradeRow[];
  semesterLabel: string;
  studentId: string;
  sq?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={<FilePen className="h-4 w-4" aria-hidden="true" />}>
          Change a grade{semesterLabel && ` — ${semesterLabel}`}
        </CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-fg-secondary">
          A published grade is changed by a correction request: you propose the new mark and a Super Admin decides it. Nothing on
          this page alters a grade on its own.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted">No grades are recorded for this student in this semester.</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th className="whitespace-nowrap">Code</Th>
                <Th>Course</Th>
                <Th className="hidden whitespace-nowrap sm:table-cell">Section</Th>
                <Th className="hidden whitespace-nowrap md:table-cell">Cr/Hrs</Th>
                <Th className="whitespace-nowrap text-center">Score</Th>
                <Th className="whitespace-nowrap text-center">Grade</Th>
                <Th className="whitespace-nowrap">Stage</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </Thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.gradeRecordId}>
                  <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{row.courseCode}</Td>
                  <Td className="font-medium text-fg">
                    {row.courseTitle}
                    {row.isRetake && <span className="ml-1 text-xs font-normal text-fg-muted">(retake)</span>}
                  </Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{row.section}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{row.creditHours}</Td>
                  <Td className="text-center">{row.score ?? "—"}</Td>
                  <Td className="text-center font-bold text-fg">{row.letter}</Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={GRADE_STATUS_TONE[row.status] ?? "neutral"}>{GRADE_STATUS_LABEL[row.status] ?? row.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    {row.correctionPending ? (
                      <span className="text-xs text-fg-muted">Correction pending</span>
                    ) : row.status === "PUBLISHED" || row.status === "LOCKED" ? (
                      <CorrectionForm row={row} studentId={studentId} sq={sq} />
                    ) : (
                      <span className="text-xs text-fg-muted">Not yet published</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/** The request itself, folded away behind the row's own button so eight
 *  courses do not become eight forms on screen at once. */
function CorrectionForm({ row, studentId, sq }: { row: StudentGradeRow; studentId: string; sq?: string }) {
  return (
    <details className="relative inline-block text-left">
      <summary
        className={buttonClasses("secondary", "sm", "cursor-pointer list-none gap-1.5")}
        aria-label={`Request a correction for ${row.courseCode}`}
      >
        <FilePen className="h-3.5 w-3.5" aria-hidden="true" />
        Correct
      </summary>
      <form
        action={requestCorrectionFromStudentGradesAction}
        className="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg"
      >
        <input type="hidden" name="gradeRecordId" value={row.gradeRecordId} />
        <input type="hidden" name="studentId" value={studentId} />
        {sq && <input type="hidden" name="sq" value={sq} />}
        <p className="text-xs text-fg-muted">
          {row.courseCode} — currently {row.letter}
          {row.score ? ` (${row.score})` : ""}
        </p>
        <div>
          <Label htmlFor={`score-${row.gradeRecordId}`} className="text-xs">
            New score
          </Label>
          <Input
            id={`score-${row.gradeRecordId}`}
            name="newScore"
            type="number"
            min={0}
            max={100}
            step="0.1"
            placeholder="0–100"
            className="py-1 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input type="checkbox" name="isIncomplete" className="h-3.5 w-3.5" />
          Record as Incomplete instead
        </label>
        <div>
          <Label htmlFor={`reason-${row.gradeRecordId}`} className="text-xs">
            Reason
          </Label>
          <Input id={`reason-${row.gradeRecordId}`} name="reason" required placeholder="Why this is being changed" className="py-1 text-xs" />
        </div>
        <Button type="submit" size="sm">
          Request correction
        </Button>
      </form>
    </details>
  );
}

function initials(student: { firstName: string; lastName: string }) {
  return `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`.toUpperCase();
}
