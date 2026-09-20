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
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Select, Input } from "@/components/ui/Form";
import { findPlanAction } from "./actions";

export const metadata: Metadata = { title: "Course plan review" };

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
  searchParams: Promise<{ semesterId?: string; error?: string; q?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId: rawSemesterId, error, q } = await searchParams;

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
  /** First and last initial, for the tile on each queue card. Decoration
   *  beside a name that is always printed next to it, so it is hidden from
   *  assistive tech by the caller. */
  const studentInitials = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    if (!s) return "?";
    return `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`.toUpperCase() || "?";
  };

  const queue = semesterId ? await getPlanQueue(actor, semesterId) : [];
  const filteredQueue = q ? queue.filter((p) => studentLabel(p.studentId).toLowerCase().includes(q.toLowerCase())) : queue;

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
        <Button type="submit" variant="secondary">
          Select
        </Button>
      </form>

      {semesterId && (
        <section className="mb-8">
          <h2 className="mb-3 font-medium text-fg">Awaiting a decision — {yearLabel(semesterId)}</h2>
          <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="semesterId" value={semesterId} />
            <div>
              <Label htmlFor="q" className="text-xs">
                Search
              </Label>
              <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Student ID or name" className="w-64" />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
            {q && (
              <Link href={`/admin/planning?semesterId=${semesterId}`} className="text-sm text-fg-muted hover:underline">
                Clear
              </Link>
            )}
          </form>
          {filteredQueue.length === 0 && (
            <Card className="border-dashed shadow-none">
              <CardBody className="py-10 text-center">
                <span className="bg-success-surface text-success-fg mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                  <ClipboardCheck className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="text-fg-secondary text-sm">
                  {q ? "No plan matches that search." : "Nothing is waiting for a decision."}
                </p>
              </CardBody>
            </Card>
          )}

          {/* One card per plan rather than a row of text with a bare word
              at the end of it. The reviewer decides which to open from the
              student and the size of the plan, so those are the two things
              given room; Review is a real button because it is the one
              thing to do here. */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredQueue.map((p) => (
              <li key={p.id}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  <span className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="bg-brand-subtle text-brand-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                    >
                      {studentInitials(p.studentId)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-fg block text-sm font-semibold">{studentLabel(p.studentId)}</span>
                      <span className="text-fg-muted mt-0.5 block text-xs">
                        {p.totalCredits} credit hours
                        {p.submittedAt ? ` \u00b7 submitted ${p.submittedAt.toISOString().slice(0, 10)}` : ""}
                      </span>
                    </span>
                  </span>

                  {/* DEV-20: the office entered this plan for the student
                      rather than the student submitting it themselves.
                      Surfaced here so the reviewer sees it before deciding. */}
                  {p.enteredBy && (
                    <span>
                      <Badge tone="brand">Admin-entered</Badge>
                    </span>
                  )}

                  <Link
                    href={`/admin/planning/${p.id}`}
                    className={buttonClasses("primary", "md", "group mt-auto w-full")}
                  >
                    <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                    Review plan
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardBody>
          <h2 className="mb-3 font-medium text-fg">Look up a specific plan</h2>
          {/* A typed Student ID rather than a <select> of all 158 students:
              the office knows the ID, and a native dropdown that long is
              the control this pass is removing everywhere. Resolved to a
              student in findPlanAction, which reports a bad ID plainly. */}
          <form action={findPlanAction} className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs" htmlFor="lookup-student">
                Student ID
              </Label>
              <Input id="lookup-student" name="studentNumber" required placeholder="e.g. 202490" className="w-64" />
            </div>
            <div>
              <Label className="text-xs">Semester</Label>
              <Select name="semesterId" required className="w-64">
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {yearLabel(s.id)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Find plan
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
