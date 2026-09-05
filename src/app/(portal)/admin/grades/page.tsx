import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { isGradeEntryOpen, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { asUser } from "@/lib/db/asUser";
import { getClassRoster } from "@/lib/grades/grades";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Select } from "@/components/ui/Form";
import ClassEntryForm from "./ClassEntryForm";
import { submitClassAction } from "./actions";

export const metadata: Metadata = { title: "Class grade entry" };

/**
 * A-12 (plan Section 20.6, Stage 10): class grade entry. Admin only
 * (REQ-R04 -- a Super Admin can publish a grade but never enter or alter
 * one, Section 15.1).
 */
export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; offeringId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, offeringId, error } = await searchParams;

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

  const [semesters, academicYears, offerings, courses, scale] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      semesterId ? tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.semesterId, semesterId) }) : Promise.resolve([]),
      tx.query.course.findMany(),
      tx.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    ]),
  );
  const activeVersion = scale.length > 0 ? Math.max(...scale.map((s) => s.policyVersion)) : 0;
  const activeScale = scale.filter((s) => s.policyVersion === activeVersion);

  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courses.find((c) => c.id === o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };

  const roster = offeringId ? await getClassRoster(actor, offeringId) : [];
  const rosterRows = roster.map((r) => ({
    registrationId: r.registrationId,
    studentNumber: r.studentNumber,
    studentName: r.studentName,
    isRetake: r.isRetake,
    gradeId: r.grade?.id ?? null,
    currentScore: r.grade?.score ?? null,
    currentLetter: r.grade?.letter ?? null,
    currentVersion: r.grade?.version ?? null,
    status: r.grade?.status ?? null,
  }));
  const enteredCount = rosterRows.filter((r) => r.gradeId).length;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Class grade entry" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Semester</Label>
          <Select name="semesterId" defaultValue={semesterId ?? ""} className="w-72">
            <option value="">Select a semester…</option>
            {semesters
              .filter((s) => isGradeEntryOpen(s.state as SemesterState))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {yearLabel(s.id)}
                </option>
              ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Select
        </Button>
      </form>

      {semesterId && (
        <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
          <input type="hidden" name="semesterId" value={semesterId} />
          <div>
            <Label className="text-xs">Class</Label>
            <Select name="offeringId" defaultValue={offeringId ?? ""} className="w-96">
              <option value="">Select a class…</option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {offeringLabel(o)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Select
          </Button>
        </form>
      )}

      {offeringId && (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            {enteredCount} of {rosterRows.length} entered
          </p>
          {rosterRows.length === 0 ? (
            <p className="text-sm text-fg-muted">No registered students in this class.</p>
          ) : (
            <>
              <ClassEntryForm offeringId={offeringId} roster={rosterRows} scale={activeScale} />
              <Card className="mt-6">
                <CardBody>
                  <CardTitle className="mb-2">Submit for approval</CardTitle>
                  <form action={submitClassAction} className="flex flex-col gap-2">
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <label className="flex items-center gap-2 text-sm text-fg-secondary">
                      <input type="checkbox" name="confirmPartial" className="h-4 w-4 rounded border-line-strong" />
                      Confirm submitting with missing grades
                    </label>
                    <input
                      name="partialNote"
                      placeholder="Note (required if submitting with missing grades)"
                      className="w-96 rounded-md border border-line-strong px-3 py-2 text-sm"
                    />
                    <Button type="submit" className="w-fit">
                      Submit
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </main>
  );
}
