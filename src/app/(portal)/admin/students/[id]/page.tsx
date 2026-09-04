import Link from "next/link";
import {
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  History,
  KeyRound,
  Pencil,
  Phone,
  School,
  TrendingUp,
} from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent, STUDENT_STATUSES } from "@/lib/students/students";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getPlansForStudent } from "@/lib/planning/planning";
import { can } from "@/lib/permissions/kernel";
import { NotFoundError } from "@/lib/errors";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { updateStudentProfileAction } from "../actions";
import { ResetPasswordForm } from "../ResetPasswordForm";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/** Same mapping the Students listing uses, so a status reads identically in both places. */
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "danger",
  GRADUATED: "info",
  ADMISSION_FORFEITED: "warning",
};

const IMPORT_STATUS_TONE: Record<string, Tone> = {
  COMPLETE: "success",
  IN_PROGRESS: "warning",
  NOT_STARTED: "neutral",
};

const PLAN_STATUS_TONE: Record<string, Tone> = {
  APPROVED: "success",
  REJECTED: "danger",
  PARTIALLY_APPROVED: "warning",
};

/** One figure with its label -- the four-up row under the profile header. */
function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Award;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
        <Icon className="h-3.5 w-3.5 text-brand-fg" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/** One label/value pair in the read-only profile view. */
function Detail({ icon: Icon, label, children }: { icon: typeof Award; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-fg">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs tracking-wide text-fg-muted uppercase">{label}</dt>
        <dd className="text-sm font-medium break-words text-fg">{children}</dd>
      </div>
    </div>
  );
}

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * A-10 (plan Section 20.5). Stage 5 built this as structure only; Stage 6
 * added entered history; Stage 7 adds GPA/CGPA, academic standing, and
 * outstanding mandatory repeats (plans and system grades are Stages 9/10).
 *
 * The interface was rebuilt in the profile redesign pass; the data
 * underneath was NOT. Every read, every permission check, the ?mode=view
 * split and `updateStudentProfileAction` are exactly as they were -- the
 * page shows the same academic history, planned courses, GPA figures and
 * profile fields, in the same tokens/cards/icon set the Students listing
 * uses. The one addition is the Edit button, which points at the very same
 * editable form this page has always rendered (the `?mode=view` route
 * without that parameter), so there is still one edit path, not two.
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

  const [departments, colleges, history, semesters, academicYears, semesterSummaries, cumulative, obligations, courses] =
    await asUser(actor.userId, (tx) =>
      Promise.all([
        tx.query.department.findMany({ orderBy: (d, { asc }) => asc(d.code) }),
        tx.query.college.findMany({ orderBy: (c, { asc }) => asc(c.code) }),
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

  // Department is the student's own field; the college is what the
  // Students listing now filters by, so both are shown here -- this page
  // is where department-level detail belongs.
  const departmentRecord = departments.find((d) => d.id === record.departmentId);
  const departmentLabel = departmentRecord ? `${departmentRecord.code} — ${departmentRecord.name}` : record.departmentId;
  const collegeRecord = departmentRecord ? colleges.find((c) => c.id === departmentRecord.collegeId) : undefined;
  const collegeLabel = collegeRecord ? `${collegeRecord.code} — ${collegeRecord.name}` : "—";

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:py-10">
      <Breadcrumb
        items={[
          { label: "Home", href: "/portal" },
          { label: "Students", href: "/admin/students" },
          { label: `${record.lastName}, ${record.firstName}` },
        ]}
      />

      {/* Identity header: who this is, at a glance, with the actions that
          apply to them. */}
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-start justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-subtle-strong text-lg font-semibold text-brand-fg"
            >
              {initials(record.firstName, record.lastName)}
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                {record.firstName} {record.lastName}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-fg-secondary">{record.studentNumber}</span>
                <Badge tone={STATUS_TONE[record.status] ?? "neutral"}>{record.status}</Badge>
                <Badge tone={IMPORT_STATUS_TONE[record.historicalImportStatus] ?? "neutral"}>
                  Import: {record.historicalImportStatus}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Item 3: editing no longer means going back to the listing to
                find the pencil. This is a link to this same page without
                ?mode=view -- i.e. the existing edit form, not a second one. */}
            {isAdmin &&
              (canEdit ? (
                <Link href={`/admin/students/${record.id}?mode=view`} className={buttonClasses("secondary", "md")}>
                  Done editing
                </Link>
              ) : (
                <Link href={`/admin/students/${record.id}`} className={buttonClasses("primary", "md")}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit student
                </Link>
              ))}
            <Link href="/admin/students" className={buttonClasses("ghost", "md")}>
              Back to students
            </Link>
          </div>
        </CardBody>
      </Card>

      {error && (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {/* The academic figures, promoted out of a definition list: these are
          what an admin opens this page to read. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Award} label="CGPA" value={cumulative?.cgpa ?? "—"} />
        <Stat
          icon={TrendingUp}
          label="Standing"
          value={cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "—"}
          hint={cumulative?.standing ? undefined : "Not yet available"}
        />
        <Stat
          icon={GraduationCap}
          label="Credits earned"
          value={cumulative ? `${cumulative.totalCreditsEarned}` : "—"}
          hint={cumulative ? `of 132 — ${cumulative.creditsToGraduation} remaining` : undefined}
        />
        <Stat icon={BookOpen} label="Credits attempted" value={cumulative ? `${cumulative.totalCreditsAttempted}` : "—"} />
      </div>

      {(cumulative?.isProvisional ?? true) && (
        <Alert tone="warning" className="mb-6 text-xs">
          Provisional -- based on records entered so far.
        </Alert>
      )}

      {obligations.length > 0 && (
        <Card className="mb-6 border-warning-line">
          <CardHeader>
            <CardTitle className="text-warning-fg">Outstanding mandatory repeats</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-1 text-sm text-fg-secondary">
              {obligations.map((o) => (
                <li key={o.recordId} className="flex items-center gap-2">
                  <Badge tone="warning">{o.letter}</Badge>
                  {o.courseCode} — {o.courseTitle}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: the profile record itself. */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>Profile</CardTitle>
              {canEdit && <Badge tone="brand">Editing</Badge>}
            </CardHeader>
            <CardBody>
              {canEdit ? (
                <form action={updateStudentProfileAction} className="flex flex-col gap-3">
                  <input type="hidden" name="studentId" value={record.id} />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Label htmlFor="firstName" className="text-xs">
                        First name
                      </Label>
                      <Input id="firstName" name="firstName" defaultValue={record.firstName} required />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="lastName" className="text-xs">
                        Last name
                      </Label>
                      <Input id="lastName" name="lastName" defaultValue={record.lastName} required />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="departmentId" className="text-xs">
                      Department
                    </Label>
                    <Select id="departmentId" name="departmentId" defaultValue={record.departmentId}>
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
                    <Input id="enrolmentYear" name="enrolmentYear" type="number" defaultValue={record.enrolmentYear} className="w-32" />
                  </div>
                  <div>
                    <Label htmlFor="contactPhone" className="text-xs">
                      Contact phone
                    </Label>
                    <Input id="contactPhone" name="contactPhone" defaultValue={record.contactPhone ?? ""} className="max-w-xs" />
                  </div>
                  <div>
                    <Label htmlFor="status" className="text-xs">
                      Status
                    </Label>
                    <Select id="status" name="status" defaultValue={record.status} className="max-w-xs">
                      {STUDENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <p className="text-xs text-fg-muted">Import status: {record.historicalImportStatus}</p>
                  <Button type="submit" className="w-fit">
                    Save changes
                  </Button>
                </form>
              ) : (
                /* Read-only view: the same fields, rendered as values
                   instead of greyed-out inputs a reader might try to type
                   into. */
                <dl className="flex flex-col gap-4">
                  <Detail icon={School} label="College">
                    {collegeLabel}
                  </Detail>
                  <Detail icon={Building2} label="Department">
                    {departmentLabel}
                  </Detail>
                  <Detail icon={CalendarDays} label="Enrolment year">
                    {record.enrolmentYear}
                  </Detail>
                  <Detail icon={Phone} label="Contact phone">
                    {record.contactPhone || "Not recorded"}
                  </Detail>
                  <Detail icon={ClipboardList} label="Import status">
                    {record.historicalImportStatus}
                  </Detail>
                </dl>
              )}
            </CardBody>
          </Card>

          {canEdit && (
            <Card>
              <CardHeader className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-brand-fg" aria-hidden="true" />
                <CardTitle>Reset password</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-xs text-fg-muted">Issues a new temporary password and forces a change on next login.</p>
                <ResetPasswordForm studentId={record.id} />
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right column: the academic record. */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {canReviewPlans && (
            <Card>
              <CardHeader className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-brand-fg" aria-hidden="true" />
                <CardTitle>Planned courses</CardTitle>
              </CardHeader>
              <CardBody>
                {plans.length === 0 && <p className="text-sm text-fg-muted">No course plans on record.</p>}
                {plans.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {plans.map((p) => (
                      <div key={p.id} className="rounded-md border border-line-subtle bg-surface-subtle p-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-fg">{yearLabel(p.semesterId)}</span>
                          <Badge tone={PLAN_STATUS_TONE[p.status] ?? "brand"}>{p.status}</Badge>
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
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-brand-fg" aria-hidden="true" />
                <CardTitle>Academic history</CardTitle>
              </span>
              {canEdit && (
                <Link href={`/admin/historical?studentId=${record.id}`} className="text-sm font-medium text-brand-fg hover:underline">
                  Enter historical record
                </Link>
              )}
            </CardHeader>
            <CardBody className={history.length > 0 ? "px-0 py-0 sm:px-0" : undefined}>
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
                          <Td className="whitespace-nowrap">{yearLabel(r.semesterId)}</Td>
                          <Td>
                            {r.courseCodeSnapshot} — {r.courseTitleSnapshot}
                          </Td>
                          <Td>{r.creditHours}</Td>
                          <Td className="font-medium text-fg">
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
        </div>
      </div>
    </main>
  );
}
