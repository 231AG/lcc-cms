import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { fullName } from "@/lib/students/name";
import { pickPlanningSemester } from "@/lib/academic/semesterStateMachine";
import { asUser } from "@/lib/db/asUser";
import { getPlanQueue } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { Label, Select, Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { TableCard } from "@/components/ui/TableCard";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { findPlanAction } from "./actions";

export const metadata: Metadata = { title: "Course plan review" };

/** A screenful at a time. The queue is read whole (it is one semester's
 *  SUBMITTED plans, tens of rows at most) and sliced here rather than in
 *  SQL, because the search filters on a student label this page assembles
 *  in memory -- paginating in the database would need that label in the
 *  database. */
const QUEUE_PAGE_SIZE = 12;

/**
 * A-11 (plan Section 20.4, Stage 9): the queue half -- plans awaiting a
 * decision for a chosen semester. Only SUBMITTED plans appear here
 * (DRAFT plans are "invisible in the Admin approval queue", Section
 * 14.2); the lookup form below reaches a specific student's plan at any
 * status, for applying a prerequisite override before submission
 * (Section 14.5 -- the override exists precisely for the "no historical
 * import yet" case, which blocks submission itself).
 */
export default async function PlanningQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string; q?: string; page?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId: rawSemesterId, error, q, page } = await searchParams;

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

  // All three in ONE transaction, students included. Fetching only the
  // queue's students was tried and measured slower: it needs the queue
  // first, so it costs an extra asUser() round trip (~950ms against
  // Supabase) to avoid reading 158 small rows inside a transaction that
  // was already open. On this database the round trip is the cost, not the
  // row count -- the reverse of the assumption.
  const [semesters, academicYears, students] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany(), tx.query.student.findMany()]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return semesterFullLabel(year, sem, semId);
  };

  // Default to the semester currently open for registration -- same
  // definition of "current semester" the student-facing /planning page
  // uses -- so the queue is populated on load without forcing a manual
  // semester pick every time. The selector stays visible and an explicit
  // choice (including re-picking the blank placeholder) is respected.
  const semesterId = rawSemesterId || pickPlanningSemester(semesters)?.id;

  const studentLabel = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${fullName(s)}` : studentId;
  };
  const studentNumber = (studentId: string) => students.find((s) => s.id === studentId)?.studentNumber ?? "—";
  const studentName = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? fullName(s) : studentId;
  };
  const queue = semesterId ? await getPlanQueue(actor, semesterId) : [];
  const filteredQueue = (q ? queue.filter((p) => studentLabel(p.studentId).toLowerCase().includes(q.toLowerCase())) : queue)
    // Oldest submission first: a queue is worked in the order things
    // arrived, and a plan that has been waiting longest should not be on
    // the last page. Plans with no submitted date sort to the end.
    .sort((a, b) => (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity));

  const pageNum = Math.max(1, Number(page) || 1);
  const lastPage = Math.max(1, Math.ceil(filteredQueue.length / QUEUE_PAGE_SIZE));
  const shownPage = Math.min(pageNum, lastPage);
  const pageRows = filteredQueue.slice((shownPage - 1) * QUEUE_PAGE_SIZE, shownPage * QUEUE_PAGE_SIZE);
  const firstOnPage = filteredQueue.length === 0 ? 0 : (shownPage - 1) * QUEUE_PAGE_SIZE + 1;
  const lastOnPage = (shownPage - 1) * QUEUE_PAGE_SIZE + pageRows.length;
  const queueHref = (p: number) =>
    `/admin/planning?${new URLSearchParams({
      ...(semesterId ? { semesterId } : {}),
      ...(q ? { q } : {}),
      ...(p > 1 ? { page: String(p) } : {}),
    }).toString()}`;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader title="Course plan review" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
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
        <SubmitButton variant="secondary">
          Select
        </SubmitButton>
      </form>

      {/* The lookup sits ABOVE the queue. Someone arriving with a
          particular student in mind -- an override to apply before they
          can submit, a question at the counter -- should not have to scroll
          past however many plans are waiting to reach the box that answers
          them. */}
      <Card className="mb-6">
        <CardBody>
          <h2 className="text-fg mb-3 font-medium">Look up a specific plan</h2>
          {/* A typed Student ID rather than a <select> of all 158 students:
              the office knows the ID, and a native dropdown that long is
              the control this pass is removing everywhere. Resolved to a
              student in findPlanAction, which reports a bad ID plainly. */}
          <form action={findPlanAction} className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs" htmlFor="lookup-student">
                Student ID
              </Label>
              <div className="w-64">
                <Input id="lookup-student" name="studentNumber" required placeholder="e.g. 202490" />
              </div>
            </div>
            <div>
              <Label className="text-xs" htmlFor="lookup-semester">
                Semester
              </Label>
              <div className="w-64">
                <Select id="lookup-semester" name="semesterId" required>
                  {semesters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {yearLabel(s.id)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <SubmitButton variant="secondary">
              Find plan
            </SubmitButton>
          </form>
        </CardBody>
      </Card>

      {semesterId && (
        <TableCard
          title={`Awaiting a decision — ${yearLabel(semesterId)}`}
          count={filteredQueue.length}
          countLabel="plan"
          actions={
            <form method="GET" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="semesterId" value={semesterId} />
              <Label htmlFor="q" className="sr-only">
                Search the queue
              </Label>
              <div className="w-56">
                <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Student ID or name" />
              </div>
              <SubmitButton variant="secondary">
                Search
              </SubmitButton>
              {q && (
                <Link href={`/admin/planning?semesterId=${semesterId}`} className="text-brand-fg text-xs font-medium hover:underline">
                  Clear
                </Link>
              )}
            </form>
          }
        >
          {filteredQueue.length === 0 ? (
            <div className="px-4 py-12 text-center sm:px-5">
              <span className="bg-success-surface text-success-fg mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                <ClipboardCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-fg-secondary text-sm">
                {q ? "No plan matches that search." : "Nothing is waiting for a decision."}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <Thead>
                  <tr>
                    <Th className="whitespace-nowrap">Student ID</Th>
                    <Th>Name</Th>
                    <Th className="whitespace-nowrap">Cr/Hrs</Th>
                    <Th className="hidden whitespace-nowrap sm:table-cell">Submitted</Th>
                    <Th className="hidden whitespace-nowrap md:table-cell">Entered by</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </Thead>
                <tbody>
                  {pageRows.map((p) => (
                    <Tr key={p.id}>
                      <Td className="text-fg-secondary font-mono text-xs whitespace-nowrap">{studentNumber(p.studentId)}</Td>
                      <Td className="text-fg font-medium">{studentName(p.studentId)}</Td>
                      <Td className="whitespace-nowrap">{p.totalCredits} Cr/Hrs</Td>
                      <Td className="text-fg-secondary hidden whitespace-nowrap sm:table-cell">
                        {p.submittedAt ? p.submittedAt.toISOString().slice(0, 10) : "—"}
                      </Td>
                      {/* DEV-20: the office entered this plan for the
                          student rather than the student submitting it
                          themselves. Surfaced before the decision, not
                          after it. */}
                      <Td className="hidden whitespace-nowrap md:table-cell">
                        {p.enteredBy ? <Badge tone="brand">Admin</Badge> : <span className="text-fg-muted text-xs">Student</span>}
                      </Td>
                      <Td className="text-right">
                        <Link
                          href={`/admin/planning/${p.id}`}
                          className={buttonClasses("primary", "sm", "group gap-1.5")}
                          aria-label={`Review plan — ${studentLabel(p.studentId)}`}
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Review plan
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>

              <div className="border-line-subtle flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
                <p className="text-fg-muted text-xs">
                  Showing {firstOnPage}–{lastOnPage} of {filteredQueue.length}
                  {q && <> matching &ldquo;{q}&rdquo;</>}
                </p>
                {lastPage > 1 && (
                  <div className="flex items-center gap-2">
                    {shownPage > 1 && (
                      <Link href={queueHref(shownPage - 1)} className={buttonClasses("secondary", "sm")}>
                        Previous
                      </Link>
                    )}
                    <span className="text-fg-muted text-xs">
                      Page {shownPage} of {lastPage}
                    </span>
                    {shownPage < lastPage && (
                      <Link href={queueHref(shownPage + 1)} className={buttonClasses("secondary", "sm")}>
                        Next
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </TableCard>
      )}

    </main>
  );
}
