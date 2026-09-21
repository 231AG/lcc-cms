import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BookMarked,
  BookOpen,
  Building2,
  CalendarDays,
  Camera,
  ClipboardList,
  GraduationCap,
  History,
  KeyRound,
  Pencil,
  Phone,
  Printer,
  School,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterDisplayName, semesterFullLabel } from "@/lib/academic/semesterName";
import { asUser } from "@/lib/db/asUser";
import { getStudent, STUDENT_STATUSES } from "@/lib/students/students";
import { getStudentPhotoMeta } from "@/lib/students/photo";
import { getGradeSheet, trimCredits } from "@/lib/gradesheet/gradeSheet";
import { fullName, listName } from "@/lib/students/name";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getPlansForStudent } from "@/lib/planning/planning";
import { getOfferingMeetingsForOfferings, getOfferingsByIds } from "@/lib/offerings/offerings";
import { formatMeetingSlots } from "@/lib/offerings/offeringRows";
import { can } from "@/lib/permissions/kernel";
import { NotFoundError } from "@/lib/errors";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { StudentAvatar } from "@/components/ui/StudentAvatar";
import { SemesterResultsPicker, SemesterResultsTable } from "@/components/grades/SemesterResults";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input, Select, Required } from "@/components/ui/Form";
import { GENDER_LABEL } from "@/lib/students/gender";
import { removeStudentPhotoAction, updateStudentProfileAction, uploadStudentPhotoAction } from "../actions";
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

/** The decision on ONE course inside a plan, when it differs from the
 *  plan's own. PENDING is the interesting case: the plan has been
 *  submitted, this course has simply not been looked at yet. */
const PLAN_ITEM_TONE: Record<string, Tone> = {
  APPROVED: "success",
  REJECTED: "danger",
  PENDING: "info",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Turned down",
  PENDING: "Awaiting decision",
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
/**
 * One labelled fact in the Profile card.
 *
 * The markup is a single `<div>` holding `<dt>` then `<dd>`, which is the
 * one wrapper HTML permits inside a `<dl>`. It used to be a div containing
 * an icon span AND a second div around the pair, so the `dt`/`dd` were two
 * levels down with a non-div sibling -- invalid, and axe reported it as two
 * serious violations (definition-list, dlitem) on every render of this page.
 * The icon moved inside the `<dt>` beside the label it belongs to, which is
 * also where it reads better: it labels the term, not the group.
 */
function Detail({ icon: Icon, label, children }: { icon: typeof Award; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted flex items-center gap-2 text-xs tracking-wide uppercase">
        <span className="bg-brand-subtle text-brand-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {label}
      </dt>
      <dd className="text-fg mt-1 pl-9 text-sm font-medium break-words">{children}</dd>
    </div>
  );
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
  searchParams: Promise<{ error?: string; mode?: string; year?: string; semesterId?: string }>;
}) {
  const actor = await getCurrentActor();
  const { id } = await params;
  const { error, mode, year: requestedYearId, semesterId: requestedSemesterId } = await searchParams;

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
    return semesterFullLabel(year, sem, semesterId);
  };
  const courseLabel = (courseId: string) => {
    const c = courses.find((c) => c.id === courseId);
    return c ? `${c.code} — ${c.title}` : courseId;
  };
  /** Year and sequence, for putting semesters in academic order. */
  const semesterSortKey = (semesterId: string) => {
    const sem = semesters.find((s) => s.id === semesterId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year
      ? { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 }
      : null;
  };
  const shortSemesterLabel = (semesterId: string) => {
    const sem = semesters.find((s) => s.id === semesterId);
    return sem ? semesterDisplayName(sem) : semesterId;
  };

  const photoMeta = await getStudentPhotoMeta(actor, record.id);

  // ONE semester of history at a time, chosen with a year and a semester --
  // the same shape the student's own screens use. Every semester at once
  // was a table that ran for two screens and pushed everything beside it
  // into whitespace, and an Admin looking a student up is almost always
  // after one term rather than the lot.
  const historySemesterIds = [...new Set(history.map((r) => r.semesterId))].sort((a, b) => {
    const ka = semesterSortKey(a);
    const kb = semesterSortKey(b);
    if (!ka || !kb) return 0;
    return kb.yearStart - ka.yearStart || kb.sequence - ka.sequence;
  });
  const yearIdOf = (semesterId: string) => semesters.find((s) => s.id === semesterId)?.academicYearId;
  const historyYearIds = [...new Set(historySemesterIds.map(yearIdOf).filter((id): id is string => !!id))];
  const selectedYearId =
    requestedYearId && historyYearIds.includes(requestedYearId) ? requestedYearId : historyYearIds[0];
  const yearSemesterIds = historySemesterIds.filter((id) => yearIdOf(id) === selectedYearId);
  const selectedSemesterId =
    requestedSemesterId && yearSemesterIds.includes(requestedSemesterId) ? requestedSemesterId : yearSemesterIds[0];
  // The same assembled figures the printed sheet uses, so this screen and
  // the paper cannot disagree about a grade point or a total.
  const sheet = selectedSemesterId ? await getGradeSheet(actor, record.id, selectedSemesterId) : null;
  const selectedSummary = selectedSemesterId ? semesterSummaryFor(selectedSemesterId) : undefined;


  const isAdmin = actor.role === "ADMIN";
  // View is read-only regardless of role; Edit is the pre-existing
  // editable form, still Admin-only. Super Admin reaching this page
  // directly (its "View" link, Section 20.5's read-only extension) is
  // always view-only, same as before.
  const canEdit = isAdmin && mode !== "view";
  const canReviewPlans = isAdmin && (await can(actor, "planning.reviewPlan"));
  const plans = canReviewPlans ? await getPlansForStudent(actor, record.id) : [];

  // When and where each planned course actually meets. One batched query
  // for the offerings and one for their meetings, not a round trip per
  // course -- the same pair the planning screens use.
  const plannedOfferingIds = [...new Set(plans.flatMap((p) => p.items.map((i) => i.offeringId)))];
  const plannedOfferings = await getOfferingsByIds(actor, plannedOfferingIds);
  const plannedMeetings = await getOfferingMeetingsForOfferings(actor, plannedOfferingIds);
  const offeringById = new Map(plannedOfferings.map((o) => [o.id, o]));

  // Department is the student's own field; the college is what the
  // Students listing now filters by, so both are shown here -- this page
  // is where department-level detail belongs.
  const departmentRecord = departments.find((d) => d.id === record.departmentId);
  const departmentLabel = departmentRecord?.name ?? record.departmentId;
  const collegeRecord = departmentRecord ? colleges.find((c) => c.id === departmentRecord.collegeId) : undefined;
  const collegeLabel = collegeRecord?.name ?? "—";

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <Breadcrumb
        items={[
          { label: "Home", href: "/portal" },
          { label: "Student Listing", href: "/admin/students" },
          { label: listName(record) },
        ]}
      />

      {/* Identity header: who this is, at a glance, with the actions that
          apply to them. */}
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-start justify-between gap-4 py-5">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-2">
              <StudentAvatar
                studentId={record.id}
                name={fullName(record)}
                hasPhoto={!!photoMeta}
                version={photoMeta?.uploadedAt.getTime()}
                size="md"
              />
              {/* The upload lives here, on the office's own screen, because
                  a student's photograph is a record field like their name
                  -- they do not edit those either. It is the only place in
                  the app that writes one. */}
              {isAdmin && (
                <div className="flex flex-col items-center gap-1">
                  <form action={uploadStudentPhotoAction} className="contents">
                    <input type="hidden" name="studentId" value={record.id} />
                    {/* The file input submits the form on change, so there
                        is no second "now upload it" button to forget. */}
                    <label className="text-brand-fg cursor-pointer text-xs font-semibold hover:underline">
                      <Camera className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      {photoMeta ? "Replace photo" : "Add photo"}
                      <input
                        type="file"
                        name="photo"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        data-auto-submit=""
                      />
                    </label>
                    {/* Only rendered when enhance.js never ran -- then the
                        change handler above does not exist and the file
                        would sit there chosen but unsent. */}
                    <button
                      type="submit"
                      className="no-enhance-only text-brand-fg block text-xs font-semibold hover:underline"
                    >
                      Upload
                    </button>
                  </form>
                  {photoMeta && (
                    <form action={removeStudentPhotoAction}>
                      <input type="hidden" name="studentId" value={record.id} />
                      <button type="submit" className="text-danger-fg text-xs font-medium hover:underline">
                        Remove
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                {fullName(record)}
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
            {/* Secondary rather than ghost, with the arrow the action is
                actually named after. A ghost link beside a filled primary
                read as disabled text, which is the opposite of what a way
                back should look like. */}
            <Link href="/admin/students" className={buttonClasses("secondary", "md", "group")}>
              <ArrowLeft
                className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
              Back to listing
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
          value={cumulative ? `${trimCredits(cumulative.totalCreditsEarned)} Cr/Hrs` : "—"}
          hint={
            cumulative
              ? `of ${cumulative.graduationCreditHours} Cr/Hrs — ${trimCredits(cumulative.creditsToGraduation)} remaining`
              : undefined
          }
        />
        <Stat
          icon={BookOpen}
          label="Credits attempted"
          value={cumulative ? `${trimCredits(cumulative.totalCreditsAttempted)} Cr/Hrs` : "—"}
        />
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

      {/* min-w-0 on both columns: a grid item defaults to min-width:auto, so
          the Academic history table's own overflow-x-auto cannot contain it
          and the whole page scrolls sideways instead -- 708px wide at a
          390px viewport. Same fix as the student dashboard. */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: the profile record itself. */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-1">
          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>Profile</CardTitle>
              {canEdit && <Badge tone="brand">Editing</Badge>}
            </CardHeader>
            <CardBody>
              {canEdit ? (
                <form action={updateStudentProfileAction} className="flex flex-col gap-3">
                  <input type="hidden" name="studentId" value={record.id} />
                  {/* Editable, and consequential: the Student ID is also how
                      the student signs in, so saving a new one moves their
                      login identifier and Auth account with it. */}
                  <div>
                    <Label htmlFor="studentNumber" className="text-xs">
                      Student ID
                      <Required />
                    </Label>
                    <Input
                      id="studentNumber"
                      name="studentNumber"
                      defaultValue={record.studentNumber}
                      required
                      className="max-w-xs font-mono"
                      aria-describedby="studentNumber-help"
                    />
                    <p id="studentNumber-help" className="mt-1 text-xs text-fg-muted">
                      Changing this also changes how the student signs in.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="min-w-32 flex-1">
                      <Label htmlFor="firstName" className="text-xs">
                        First name
                        <Required />
                      </Label>
                      <Input id="firstName" name="firstName" defaultValue={record.firstName} required />
                    </div>
                    {/* Optional, and clearable: submitting it empty removes a
                        middle name that was recorded by mistake. */}
                    <div className="min-w-32 flex-1">
                      <Label htmlFor="middleName" className="text-xs">
                        Middle name
                      </Label>
                      <Input id="middleName" name="middleName" defaultValue={record.middleName ?? ""} />
                    </div>
                    <div className="min-w-32 flex-1">
                      <Label htmlFor="lastName" className="text-xs">
                        Last name
                        <Required />
                      </Label>
                      <Input id="lastName" name="lastName" defaultValue={record.lastName} required />
                    </div>
                  </div>
                  {/* Surfaced whether or not it has a value: a student
                      enrolled before gender existed has none, and an empty
                      required-looking field is exactly the prompt to fill it
                      in. The placeholder option is selectable so saving an
                      unrelated edit does not force a value to be invented. */}
                  <div>
                    <Label htmlFor="gender" className="text-xs">
                      Gender
                    </Label>
                    <Select id="gender" name="gender" defaultValue={record.gender ?? ""} className="max-w-xs">
                      <option value="">Not recorded</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="departmentId" className="text-xs">
                      Department
                      <Required />
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
                    <Label htmlFor="minor" className="text-xs">
                      Minor
                    </Label>
                    <Input id="minor" name="minor" defaultValue={record.minor ?? ""} placeholder="None" className="max-w-xs" />
                  </div>
                  <div>
                    <Label htmlFor="contactPhone" className="text-xs">
                      Phone
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
                  <Detail icon={UserRound} label="Gender">
                    {GENDER_LABEL[record.gender ?? ""] ?? "—"}
                  </Detail>
                  <Detail icon={BookMarked} label="Minor">
                    {record.minor || "—"}
                  </Detail>
                  <Detail icon={CalendarDays} label="Enrolment year">
                    {record.enrolmentYear}
                  </Detail>
                  <Detail icon={Phone} label="Phone">
                    {record.contactPhone || "—"}
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
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
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
                        {/* The per-course decision is shown only when it
                            DIFFERS from the plan's own -- every row of an
                            approved plan saying "approved" is the badge
                            above repeated N times. A partly-approved plan
                            still names which course went which way, and a
                            refusal still carries its reason: that is the
                            case the redundancy was hiding. The room and
                            time take the space it gives back. */}
                        <ul className="flex flex-col gap-1.5">
                          {p.items.map((i) => {
                            const offering = offeringById.get(i.offeringId);
                            const when = formatMeetingSlots(plannedMeetings.get(i.offeringId) ?? []);
                            const meta = [
                              offering?.section ? `Section ${offering.section}` : null,
                              offering ? `${offering.frozenCreditHours} cr` : null,
                              i.isRetake ? "Retake" : null,
                            ].filter(Boolean);
                            return (
                              <li key={i.id} className="border-line-subtle bg-surface rounded-lg border px-3 py-2">
                                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                  <span className="text-fg min-w-0 text-sm font-medium">{courseLabel(i.courseId)}</span>
                                  {i.status !== p.status && (
                                    <Badge tone={PLAN_ITEM_TONE[i.status] ?? "neutral"}>{ITEM_STATUS_LABEL[i.status] ?? i.status}</Badge>
                                  )}
                                </span>
                                {(when.length > 0 || meta.length > 0) && (
                                  <span className="text-fg-muted mt-0.5 block text-xs">
                                    {[...when, ...meta].join(" \u00b7 ")}
                                  </span>
                                )}
                                {i.status === "REJECTED" && i.rejectionReason && (
                                  <span className="text-danger-fg mt-0.5 block text-xs">{i.rejectionReason}</span>
                                )}
                              </li>
                            );
                          })}
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
              <span className="flex items-center gap-3">
                {/* Opens the College's own grade sheet for the semester on
                    screen -- the letterhead document the Registrar prints,
                    not a second rendering of these numbers. */}
                {sheet && selectedSemesterId && (
                  <Link
                    href={`/admin/students/${record.id}/grade-sheet/${selectedSemesterId}?print=1`}
                    title="Print or save as PDF"
                    aria-label="Print or save as PDF"
                    className="text-fg-muted hover:bg-surface-hover hover:text-brand-fg focus-visible:outline-focus-ring inline-flex rounded-md p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
                {canEdit && (
                  <Link href={`/admin/historical?studentId=${record.id}`} className="text-brand-fg text-sm font-medium hover:underline">
                    Enter historical record
                  </Link>
                )}
              </span>
            </CardHeader>

            {historySemesterIds.length > 0 && (
              <SemesterResultsPicker
                years={historyYearIds.map((id) => ({ id, label: academicYears.find((y) => y.id === id)?.label ?? id }))}
                semesters={yearSemesterIds.map((id) => ({ id, label: shortSemesterLabel(id) }))}
                selectedYearId={selectedYearId}
                selectedSemesterId={selectedSemesterId}
                // A GET form replaces the query string, so the read-only
                // view would flip back to the edit form on every change.
                hiddenFields={mode ? { mode } : undefined}
              />
            )}

            <CardBody>
              {history.length === 0 && (
                <p className="text-fg-muted text-sm">
                  Empty -- the import status above explains why nothing appears here yet.
                </p>
              )}
              {sheet && (
                <SemesterResultsTable
                  sheet={sheet}
                  label={yearLabel(selectedSemesterId!)}
                  sortKey={semesterSortKey(selectedSemesterId!) ?? undefined}
                  isProvisional={selectedSummary?.isProvisional}
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </main>
  );
}
