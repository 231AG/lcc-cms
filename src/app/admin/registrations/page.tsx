import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getRegistrationsForOffering } from "@/lib/planning/planning";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { dropRegistrationAction, registerDirectAction } from "./actions";

export const metadata: Metadata = { title: "Registrations" };

/**
 * A-17 (plan Section 20.4, Stage 9, DEC-14): registrations for one
 * offering -- direct registration and drop, both with a mandatory reason
 * since these are administrative acts that may legitimately deviate from
 * the normal plan-approval path (Section 14.4).
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ offeringId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { offeringId, error } = await searchParams;

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

  const [offerings, courses, students] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.status, "PUBLISHED") }),
      tx.query.course.findMany(),
      tx.query.student.findMany({ where: (s, { eq }) => eq(s.status, "ACTIVE") }),
    ]),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courseFor(o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };
  const studentLabel = (studentId: string) => {
    const s = students.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${s.firstName} ${s.lastName}` : studentId;
  };

  const registrations = offeringId ? await getRegistrationsForOffering(actor, offeringId) : [];

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Registrations" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="offeringId" className="text-xs">
            Offering
          </Label>
          <Select id="offeringId" name="offeringId" defaultValue={offeringId ?? ""} className="w-96">
            <option value="">Select an offering…</option>
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

      {offeringId && (
        <>
          <Card className="mb-6">
            <CardBody>
              <h2 className="mb-3 font-medium text-neutral-900">Register a student directly</h2>
              <form action={registerDirectAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="offeringId" value={offeringId} />
                <div>
                  <Label className="text-xs">Student</Label>
                  <Select name="studentId" required className="w-64">
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.studentNumber} — {s.firstName} {s.lastName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reason</Label>
                  <Input name="reason" required className="w-64" />
                </div>
                <Button type="submit">Register</Button>
              </form>
            </CardBody>
          </Card>

          <section>
            <h2 className="mb-3 font-medium text-neutral-900">Class list</h2>
            {registrations.length === 0 && <p className="text-sm text-neutral-500">No registrations yet.</p>}
            <ul className="flex flex-col gap-2">
              {registrations.map((r) => (
                <li key={r.id}>
                  <Card className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {studentLabel(r.studentId)} — {r.status}
                      {r.isRetake && " — retake"} — {r.source === "ADMIN_DIRECT" ? "direct" : "plan"}
                      {r.status === "DROPPED" && r.droppedReason && ` (${r.droppedReason})`}
                    </span>
                    {r.status === "REGISTERED" && (
                      <form action={dropRegistrationAction} className="flex items-center gap-2">
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="registrationId" value={r.id} />
                        <input name="reason" required placeholder="Reason" className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                        <button type="submit" className="text-xs font-medium text-danger-600 hover:underline">
                          Drop
                        </button>
                      </form>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
