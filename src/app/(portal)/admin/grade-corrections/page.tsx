import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { asUser } from "@/lib/db/asUser";
import { getCorrectionQueue } from "@/lib/grades/grades";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Select } from "@/components/ui/Form";
import { decideCorrectionAction, requestCorrectionAction } from "./actions";

export const metadata: Metadata = { title: "Grade corrections" };

/**
 * X-03 (plan Section 24.11, Stage 10): grade corrections. Admin requests
 * (REQ-R06); Super Admin decides -- never the same actor (Section 15.5),
 * one role-conditional page matching the established pattern.
 */
export default async function GradeCorrectionsPage({
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
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Grade corrections" />
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {actor.role === "ADMIN" ? (
        <AdminRequestSection actor={actor} semesterId={semesterId} offeringId={offeringId} />
      ) : (
        <SuperAdminDecideSection actor={actor} />
      )}
    </main>
  );
}

async function AdminRequestSection({
  actor,
  semesterId,
  offeringId,
}: {
  actor: NonNullable<Awaited<ReturnType<typeof getCurrentActor>>>;
  semesterId?: string;
  offeringId?: string;
}) {
  const [semesters, academicYears, offerings, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      semesterId ? tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.semesterId, semesterId) }) : Promise.resolve([]),
      tx.query.course.findMany(),
    ]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return semesterFullLabel(year, sem, semId);
  };
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courses.find((c) => c.id === o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };

  const publishedGrades = offeringId
    ? await asUser(actor.userId, async (tx) => {
        const regs = await tx.query.registration.findMany({ where: (r, { eq }) => eq(r.offeringId, offeringId) });
        const regIds = regs.map((r) => r.id);
        if (regIds.length === 0) return [];
        return tx.query.gradeRecord.findMany({
          where: (g, { and, inArray }) => and(inArray(g.registrationId, regIds), inArray(g.status, ["PUBLISHED", "LOCKED"])),
        });
      })
    : [];

  return (
    <>
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Semester</Label>
          <Select name="semesterId" defaultValue={semesterId ?? ""} className="w-72">
            <option value="">Select a semester…</option>
            {semesters.map((s) => (
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
        <section>
          <h2 className="mb-3 font-medium text-fg">Published grades</h2>
          {publishedGrades.length === 0 && <p className="text-sm text-fg-muted">No published grades in this class.</p>}
          <ul className="flex flex-col gap-3">
            {publishedGrades.map((g) => (
              <li key={g.id}>
                <Card className="p-3 text-sm">
                  <p className="mb-2 text-fg">
                    Current: {g.letter}
                    {g.score ? ` (${g.score})` : ""}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-brand-fg hover:underline">Request a correction</summary>
                    <form action={requestCorrectionAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="gradeRecordId" value={g.id} />
                      <input
                        name="newScore"
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        placeholder="New score"
                        className="w-24 rounded-md border border-line-strong px-2 py-1 text-xs"
                      />
                      <label className="flex items-center gap-1 text-xs text-fg-secondary">
                        <input type="checkbox" name="isIncomplete" className="h-3.5 w-3.5 rounded border-line-strong" /> Incomplete
                      </label>
                      <input name="reason" required placeholder="Reason" className="w-64 rounded-md border border-line-strong px-2 py-1 text-xs" />
                      <Button type="submit" variant="secondary" size="sm">
                        Request
                      </Button>
                    </form>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function SuperAdminDecideSection({ actor }: { actor: NonNullable<Awaited<ReturnType<typeof getCurrentActor>>> }) {
  const queue = await getCorrectionQueue(actor);

  return (
    <section>
      <h2 className="mb-3 font-medium text-fg">Pending correction requests</h2>
      {queue.length === 0 && <p className="text-sm text-fg-muted">No corrections awaiting a decision.</p>}
      <ul className="flex flex-col gap-3">
        {queue.map((r) => (
          <li key={r.id}>
            <Card className="p-3 text-sm">
              <p className="mb-1 text-fg">
                {r.oldLetter}
                {r.oldScore ? ` (${r.oldScore})` : ""} → {r.newLetter}
                {r.newScore ? ` (${r.newScore})` : ""}
              </p>
              <p className="mb-2 text-xs text-fg-muted">Reason: {r.reason}</p>
              <div className="flex flex-wrap items-end gap-2">
                <form action={decideCorrectionAction}>
                  <input type="hidden" name="correctionRequestId" value={r.id} />
                  <input type="hidden" name="decision" value="APPROVE" />
                  <Button type="submit" size="sm">
                    Approve
                  </Button>
                </form>
                <form action={decideCorrectionAction} className="flex items-end gap-2">
                  <input type="hidden" name="correctionRequestId" value={r.id} />
                  <input type="hidden" name="decision" value="REJECT" />
                  <input name="note" placeholder="Note" className="w-48 rounded-md border border-line-strong px-2 py-1 text-xs" />
                  <Button type="submit" variant="danger" size="sm">
                    Reject
                  </Button>
                </form>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
