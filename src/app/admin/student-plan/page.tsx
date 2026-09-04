import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent, searchStudents } from "@/lib/students/students";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { getOfferingMeetingsForOfferings, getOfferingsByIds, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { filterOfferings, pageSlice } from "@/lib/offerings/offeringSearch";
import { getPlanForStudentSemester, getPlanItems } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { OfferingPicker } from "@/components/planning/OfferingPicker";
import {
  startStudentPlanAction,
  addStudentPlanItemAction,
  removeStudentPlanItemAction,
  submitStudentPlanAction,
  deleteStudentDraftPlanAction,
} from "./actions";

export const metadata: Metadata = { title: "Course plan entry" };

const PAGE_SIZE = 20;

/**
 * DEV-20 -- an Admin building and submitting a course plan on behalf of a
 * student who cannot use the app themselves (no Android phone; Section
 * 17.8's year-one reality).
 *
 * Deliberately the SAME screen shape as the student's own /planning page,
 * over the same OfferingPicker component and the same service functions:
 * `getOrCreateDraftPlan` / `addPlanItem` / `removePlanItem` / `submitPlan`
 * with an explicit student. All six validators, the credit ceiling and the
 * DRAFT -> SUBMITTED transition are therefore identical by construction,
 * and the submitted plan lands in the ordinary /admin/planning queue with
 * no separate approval path.
 *
 * Admin-only: Super Admin has no role in course planning at all (Section
 * 9.4.9), which is why this page does not follow the "one page,
 * role-conditional controls" pattern the students/calendar pages use.
 */
export default async function StudentPlanEntryPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    semesterId?: string;
    sq?: string;
    q?: string;
    page?: string;
    error?: string;
    submitted?: string;
  }>;
}) {
  const actor = await getCurrentActor();
  const { studentId, semesterId: rawSemesterId, sq, q, page, error, submitted } = await searchParams;

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

  const [semesters, academicYears] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany()]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };

  // Same definition of "the current semester" the student-facing page uses,
  // so the Admin lands on the right one without picking it every time.
  const semesterId = rawSemesterId || semesters.find((s) => s.state === "REGISTRATION")?.id;
  const semesterState = semesters.find((s) => s.id === semesterId)?.state;

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
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title="Course plan entry"
        description="Build and submit a course plan for a student who cannot use the app themselves. It goes to Course plan review like any other plan."
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {submitted && !error && (
        <Alert tone="success" className="mb-4">
          Plan submitted. It is now in the Course plan review queue awaiting a decision.{" "}
          <Link href="/admin/planning" className="font-medium underline">
            Go to the queue
          </Link>
        </Alert>
      )}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        {studentId && <input type="hidden" name="studentId" value={studentId} />}
        <div>
          <Label htmlFor="semesterId" className="text-xs">
            Semester
          </Label>
          <Select id="semesterId" name="semesterId" defaultValue={semesterId ?? ""} className="w-72">
            <option value="">Select a semester…</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {yearLabel(s.id)} ({s.state})
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Select
        </Button>
      </form>

      {semesterId && semesterState !== "REGISTRATION" && (
        <Alert tone="warning" className="mb-6">
          {yearLabel(semesterId)} is {semesterState}, not Registration. Course planning is only open while a semester is in
          Registration, so a plan cannot be built or submitted for it.
        </Alert>
      )}

      {!chosen ? (
        <StudentChooser actor={actor} sq={sq} semesterId={semesterId} />
      ) : (
        <StudentPlanEditor
          actor={actor}
          student={chosen}
          semesterId={semesterId}
          semesterLabel={semesterId ? yearLabel(semesterId) : ""}
          canEdit={semesterState === "REGISTRATION"}
          sq={sq}
          q={q}
          page={page}
        />
      )}
    </main>
  );
}

/** Search-and-pick rather than a <select> of every student: there are 158
 * live student rows and rendering them all as options is the pattern this
 * pass is removing elsewhere. */
async function StudentChooser({
  actor,
  sq,
  semesterId,
}: {
  actor: Actor;
  sq?: string;
  semesterId?: string;
}) {
  const results = sq?.trim() ? await searchStudents(actor, { query: sq, page: 1, pageSize: 10 }) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a student</CardTitle>
      </CardHeader>
      <CardBody>
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          {semesterId && <input type="hidden" name="semesterId" value={semesterId} />}
          <div>
            <Label htmlFor="sq" className="text-xs">
              Search students
            </Label>
            <Input id="sq" name="sq" defaultValue={sq ?? ""} placeholder="Student ID or name" className="w-64" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {!results && <p className="text-sm text-neutral-500">Search for a student by Student ID or name to begin.</p>}

        {results && results.rows.length === 0 && (
          <p className="text-sm text-neutral-500">No students match &ldquo;{sq}&rdquo;.</p>
        )}

        {results && results.rows.length > 0 && (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th>Student ID</Th>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </Thead>
              <tbody>
                {results.rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-mono text-xs text-neutral-700">{s.studentNumber}</Td>
                    <Td className="font-medium text-neutral-900">
                      {s.lastName}, {s.firstName}
                    </Td>
                    <Td>{s.status}</Td>
                    <Td>
                      <Link
                        href={`/admin/student-plan?studentId=${s.id}${semesterId ? `&semesterId=${semesterId}` : ""}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        Plan courses
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {results.total > results.rows.length && (
              <p className="mt-3 text-xs text-neutral-500">
                Showing the first {results.rows.length} of {results.total} matches — narrow the search to see others.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

const PLAN_STATUS_TONE = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
  PARTIALLY_APPROVED: "warning",
} as const;

async function StudentPlanEditor({
  actor,
  student,
  semesterId,
  semesterLabel,
  canEdit,
  sq,
  q,
  page,
}: {
  actor: Actor;
  student: { id: string; studentNumber: string; firstName: string; lastName: string; status: string };
  semesterId?: string;
  semesterLabel: string;
  canEdit: boolean;
  sq?: string;
  q?: string;
  page?: string;
}) {
  const backHref = `/admin/student-plan${semesterId ? `?semesterId=${semesterId}` : ""}${sq ? `&sq=${encodeURIComponent(sq)}` : ""}`;

  const header = (
    <Card className="mb-6">
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-neutral-900">
            {student.firstName} {student.lastName}
          </p>
          <p className="text-xs text-neutral-500">
            <span className="font-mono">{student.studentNumber}</span> &middot; {student.status}
            {semesterLabel && <> &middot; {semesterLabel}</>}
          </p>
        </div>
        <Link href={backHref} className="text-sm font-medium text-brand-700 hover:underline">
          Choose a different student
        </Link>
      </CardBody>
    </Card>
  );

  if (!semesterId) {
    return (
      <>
        {header}
        <Alert tone="info">Select a semester above to build a plan.</Alert>
      </>
    );
  }

  const plan = await getPlanForStudentSemester(actor, student.id, semesterId);
  const items = plan ? await getPlanItems(actor, plan.id) : [];
  const isEditable = canEdit && (!plan || plan.status === "DRAFT" || plan.status === "REJECTED");

  const [availableOfferings, courses] = await Promise.all([
    isEditable ? getOfferingsForSemester(actor, semesterId) : Promise.resolve([]),
    asUser(actor.userId, (tx) => tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true) })),
  ]);
  const referencedOfferings = isEditable ? [] : await getOfferingsByIds(actor, [...new Set(items.map((i) => i.offeringId))]);
  const offeringById = new Map([...availableOfferings, ...referencedOfferings].map((o) => [o.id, o]));
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);

  const plannedOfferingIds = new Set(items.map((i) => i.offeringId));
  const totalCredits = items.reduce((sum, i) => sum + (offeringById.get(i.offeringId)?.frozenCreditHours ?? 0), 0);

  const matching = filterOfferings(availableOfferings, courses, q);
  const { rows: pagedOfferings, page: pageNum } = pageSlice(matching, Number(page) || 1, PAGE_SIZE);
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, pagedOfferings.map((o) => o.id));

  const baseFields: Record<string, string> = { studentId: student.id, semesterId };
  const contextFields: Record<string, string> = {
    ...baseFields,
    ...(q ? { q } : {}),
    ...(pageNum > 1 ? { page: String(pageNum) } : {}),
  };
  const listParams = (overrides: Record<string, string | undefined> = {}) => {
    const merged: Record<string, string | undefined> = { q, page: String(pageNum), ...overrides };
    const params = new URLSearchParams(baseFields);
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  };

  return (
    <>
      {header}

      {plan && plan.status !== "DRAFT" && (
        <Card className="mb-6">
          <CardBody className="flex flex-wrap items-center gap-3">
            <Badge tone={PLAN_STATUS_TONE[plan.status as keyof typeof PLAN_STATUS_TONE] ?? "neutral"}>{plan.status}</Badge>
            <span className="text-sm text-neutral-600">
              {plan.totalCredits} credit hours
              {plan.status === "SUBMITTED" && " — awaiting a decision in Course plan review"}
            </span>
            {plan.status === "REJECTED" && plan.rejectionReason && (
              <span className="text-sm text-danger-700">Reason: {plan.rejectionReason}</span>
            )}
            <Link href={`/admin/planning/${plan.id}`} className="ml-auto text-sm font-medium text-brand-700 hover:underline">
              Open in Course plan review
            </Link>
          </CardBody>
        </Card>
      )}

      {!plan && canEdit && (
        <form action={startStudentPlanAction} className="mb-6">
          {Object.entries(baseFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton pendingLabel="Starting…">Start a plan for this student</SubmitButton>
        </form>
      )}

      {!plan && !canEdit && <Alert tone="info">This student has no plan for {semesterLabel}.</Alert>}

      {plan && (plan.status === "DRAFT" || plan.status === "REJECTED") && (
        <>
          <Card className="mb-6">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Planned courses — {totalCredits} credit hours</CardTitle>
              {plan.enteredBy && <Badge tone="brand">Admin-entered</Badge>}
            </CardHeader>
            <CardBody>
              {items.length === 0 && <p className="mb-3 text-sm text-neutral-500">No courses added yet.</p>}
              <ul className="mb-4 flex flex-col gap-2">
                {items.map((i) => {
                  const c = courseFor(i.courseId);
                  const o = offeringById.get(i.offeringId);
                  return (
                    <li key={i.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm">
                      <span>
                        {c ? `${c.code} — ${c.title}` : i.courseId} (Section {o?.section}){i.isRetake && " — retake"}
                      </span>
                      {isEditable && (
                        <form action={removeStudentPlanItemAction}>
                          {Object.entries(contextFields).map(([name, value]) => (
                            <input key={name} type="hidden" name={name} value={value} />
                          ))}
                          <input type="hidden" name="planItemId" value={i.id} />
                          <SubmitTextButton pendingLabel="Removing…" className="text-xs font-medium text-danger-600 hover:underline">
                            Remove
                          </SubmitTextButton>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
              {isEditable && (
                <div className="flex items-center gap-3">
                  <form action={submitStudentPlanAction}>
                    {Object.entries(contextFields).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <input type="hidden" name="planId" value={plan.id} />
                    <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
                  </form>
                  {plan.status === "DRAFT" && (
                    <form action={deleteStudentDraftPlanAction}>
                      {Object.entries(baseFields).map(([name, value]) => (
                        <input key={name} type="hidden" name={name} value={value} />
                      ))}
                      <input type="hidden" name="planId" value={plan.id} />
                      <button type="submit" className="text-xs font-medium text-danger-600 hover:underline">
                        Delete draft
                      </button>
                    </form>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {isEditable && (
            <OfferingPicker
              offerings={pagedOfferings}
              courses={courses}
              meetingsByOffering={meetingsByOffering}
              plannedOfferingIds={plannedOfferingIds}
              q={q}
              page={pageNum}
              pageSize={PAGE_SIZE}
              totalMatching={matching.length}
              totalAvailable={availableOfferings.length}
              hrefForPage={(p) => `/admin/student-plan?${listParams({ page: String(p) })}`}
              clearSearchHref={`/admin/student-plan?${listParams({ q: undefined, page: undefined })}`}
              searchHiddenFields={baseFields}
              addAction={addStudentPlanItemAction}
              addHiddenFields={{ ...contextFields, planId: plan.id }}
            />
          )}
        </>
      )}

      {plan && (plan.status === "SUBMITTED" || plan.status === "APPROVED" || plan.status === "PARTIALLY_APPROVED") && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Planned courses</CardTitle>
            {plan.enteredBy && <Badge tone="brand">Admin-entered</Badge>}
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((i) => {
                const c = courseFor(i.courseId);
                return (
                  <li key={i.id} className="flex items-center justify-between">
                    <span>{c ? `${c.code} — ${c.title}` : i.courseId}</span>
                    <span className="text-xs text-neutral-500">
                      {i.status === "PENDING" ? "Awaiting decision" : i.status === "APPROVED" ? "Approved" : "Rejected"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Link href={`/admin/planning/${plan.id}`} className={buttonClasses("secondary", "sm", "mt-4")}>
              Review this plan
            </Link>
          </CardBody>
        </Card>
      )}
    </>
  );
}
