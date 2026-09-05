import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { fullName } from "@/lib/students/name";
import { asUser } from "@/lib/db/asUser";
import { filterOfferings, pageSlice } from "@/lib/offerings/offeringSearch";
import { getRegistrationsForOffering } from "@/lib/planning/planning";
import { searchStudents } from "@/lib/students/students";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { Label, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { dropRegistrationAction, registerDirectAction } from "./actions";

export const metadata: Metadata = { title: "Registrations" };

const OFFERINGS_PER_PAGE = 15;

/**
 * A-17 (plan Section 20.4, Stage 9, DEC-14): registrations for one
 * offering -- direct registration and drop, both with a mandatory reason
 * since these are administrative acts that may legitimately deviate from
 * the normal plan-approval path (Section 14.4).
 *
 * Both pickers on this page used to be `<select>`s over the entire
 * database: every published offering (177 in the real 2026/2027 schedule)
 * and every active student (158). That is unusable as a control long
 * before it is slow -- you cannot find "Comfort Doe" in a 158-item native
 * dropdown -- so both are now search-driven, matching how
 * /admin/student-plan picks a student.
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ offeringId?: string; error?: string; oq?: string; opage?: string; sq?: string }>;
}) {
  const actor = await getCurrentActor();
  const { offeringId, error, oq, opage, sq } = await searchParams;

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

  const [offerings, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.courseOffering.findMany({ where: (o, { eq }) => eq(o.status, "PUBLISHED") }),
      tx.query.course.findMany(),
    ]),
  );
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);
  const offeringLabel = (o: (typeof offerings)[number]) => {
    const c = courseFor(o.courseId);
    return `${c ? `${c.code} — ${c.title}` : o.courseId} (Section ${o.section})`;
  };

  const selectedOffering = offeringId ? offerings.find((o) => o.id === offeringId) : undefined;
  const registrations = offeringId ? await getRegistrationsForOffering(actor, offeringId) : [];

  // Only the students actually on this class list need resolving, rather
  // than every active student in the college.
  const registeredStudentIds = [...new Set(registrations.map((r) => r.studentId))];
  const classListStudents = registeredStudentIds.length
    ? await asUser(actor.userId, (tx) =>
        tx.query.student.findMany({ where: (s, { inArray }) => inArray(s.id, registeredStudentIds) }),
      )
    : [];
  const studentLabel = (studentId: string) => {
    const s = classListStudents.find((s) => s.id === studentId);
    return s ? `${s.studentNumber} — ${fullName(s)}` : studentId;
  };

  // Candidates for direct registration: searched, not enumerated.
  const candidates = sq?.trim() ? await searchStudents(actor, { query: sq, status: "ACTIVE", page: 1, pageSize: 10 }) : undefined;

  const matchingOfferings = filterOfferings(offerings, courses, oq);
  const { rows: pagedOfferings, page: offeringPage, totalPages: offeringPages } = pageSlice(
    matchingOfferings,
    Number(opage) || 1,
    OFFERINGS_PER_PAGE,
  );

  const hrefWith = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { offeringId, oq, opage: String(offeringPage), sq, ...params };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return `/admin/registrations?${sp.toString()}`;
  };

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Registrations" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-6">
        <CardBody>
          <h2 className="mb-3 font-medium text-fg">
            {selectedOffering ? "Offering" : "Choose an offering"}
          </h2>

          {selectedOffering ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-fg">{offeringLabel(selectedOffering)}</span>
              <Link href="/admin/registrations" className="text-sm font-medium text-brand-fg hover:underline">
                Choose a different offering
              </Link>
            </div>
          ) : (
            <>
              <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="oq" className="text-xs">
                    Search offerings
                  </Label>
                  <Input id="oq" name="oq" defaultValue={oq ?? ""} placeholder="Code, title or instructor" className="w-72" />
                </div>
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
              <p className="mb-2 text-xs text-fg-muted">
                {matchingOfferings.length === 0
                  ? `No published offerings match "${oq}".`
                  : `${matchingOfferings.length} published offering${matchingOfferings.length === 1 ? "" : "s"}${oq ? ` matching "${oq}"` : ""}.`}
              </p>
              <ul className="flex flex-col gap-1.5">
                {pagedOfferings.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
                    <span>{offeringLabel(o)}</span>
                    <Link href={hrefWith({ offeringId: o.id })} className="shrink-0 font-medium text-brand-fg hover:underline">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination
                page={offeringPage}
                totalPages={offeringPages}
                hrefForPage={(p) => hrefWith({ opage: String(p) })}
                className="mt-3"
                label="Offerings pagination"
              />
            </>
          )}
        </CardBody>
      </Card>

      {offeringId && (
        <>
          <Card className="mb-6">
            <CardBody>
              <h2 className="mb-3 font-medium text-fg">Register a student directly</h2>

              <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="offeringId" value={offeringId} />
                <div>
                  <Label htmlFor="sq" className="text-xs">
                    Find a student
                  </Label>
                  <Input id="sq" name="sq" defaultValue={sq ?? ""} placeholder="Student ID or name" className="w-64" />
                </div>
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>

              {!candidates && <p className="text-sm text-fg-muted">Search for a student to register them directly.</p>}
              {candidates && candidates.rows.length === 0 && (
                <p className="text-sm text-fg-muted">No active students match &ldquo;{sq}&rdquo;.</p>
              )}

              {candidates && candidates.rows.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {candidates.rows.map((s) => (
                    <li key={s.id} className="rounded-md border border-line px-3 py-2">
                      <form action={registerDirectAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="studentId" value={s.id} />
                        <span className="mb-1.5 grow text-sm">
                          <span className="font-mono text-xs text-fg-secondary">{s.studentNumber}</span> — {fullName(s)}
                        </span>
                        <div>
                          <Label className="text-xs">Reason</Label>
                          <Input name="reason" required className="w-56" />
                        </div>
                        <SubmitButton pendingLabel="Registering…">Register</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <section>
            <h2 className="mb-3 font-medium text-fg">Class list</h2>
            {registrations.length === 0 && <p className="text-sm text-fg-muted">No registrations yet.</p>}
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
                        <input name="reason" required placeholder="Reason" className="w-40 rounded-md border border-line-strong px-2 py-1 text-xs" />
                        <SubmitTextButton pendingLabel="Dropping…" className="text-xs font-medium text-danger-fg hover:underline">
                          Drop
                        </SubmitTextButton>
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
