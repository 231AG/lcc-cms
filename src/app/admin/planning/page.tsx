import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getPlanQueue } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

  const [semesters, academicYears, students] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.semester.findMany(), tx.query.academicYear.findMany(), tx.query.student.findMany()]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const studentLabel = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${s.firstName} ${s.lastName}` : studentId;
  };

  // Default to the semester currently open for registration -- same
  // definition of "current semester" the student-facing /planning page
  // uses -- so the queue is populated on load without forcing a manual
  // semester pick every time. The selector stays visible and an explicit
  // choice (including re-picking the blank placeholder) is respected.
  const semesterId = rawSemesterId || semesters.find((s) => s.state === "REGISTRATION")?.id;

  const queue = semesterId ? await getPlanQueue(actor, semesterId) : [];
  const filteredQueue = q ? queue.filter((p) => studentLabel(p.studentId).toLowerCase().includes(q.toLowerCase())) : queue;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
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
          <h2 className="mb-3 font-medium text-neutral-900">Awaiting a decision -- {yearLabel(semesterId)}</h2>
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
              <Link href={`/admin/planning?semesterId=${semesterId}`} className="text-sm text-neutral-500 hover:underline">
                Clear
              </Link>
            )}
          </form>
          {filteredQueue.length === 0 && (
            <p className="text-sm text-neutral-500">{q ? "No matching plans." : "No plans awaiting approval."}</p>
          )}
          <ul className="flex flex-col gap-2">
            {filteredQueue.map((p) => (
              <li key={p.id}>
                <Card className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {studentLabel(p.studentId)} — {p.totalCredits} credit hours
                    </span>
                    {/* DEV-20: the office entered this plan for the student
                        rather than the student submitting it themselves.
                        Surfaced here so the reviewer sees it before deciding. */}
                    {p.enteredBy && <Badge tone="brand">Admin-entered</Badge>}
                  </span>
                  <Link href={`/admin/planning/${p.id}`} className="font-medium text-brand-700 hover:underline">
                    Review
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardBody>
          <h2 className="mb-3 font-medium text-neutral-900">Look up a specific plan</h2>
          <form action={findPlanAction} className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Student ID</Label>
              <Select name="studentId" required className="w-64">
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.studentNumber} — {s.firstName} {s.lastName}
                  </option>
                ))}
              </Select>
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
