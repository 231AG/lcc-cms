import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsForSemester } from "@/lib/offerings/offerings";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import {
  addMeetingAction,
  cancelOfferingAction,
  createOfferingAction,
  publishOfferingAction,
  removeMeetingAction,
  updateOfferingAction,
} from "./actions";

export const metadata: Metadata = { title: "Course offerings" };

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A-08 (plan Section 20.4, Stage 8): the semester's offerings, sections,
 * instructors and meeting times. Admin creates/edits/publishes/cancels;
 * Super Admin sees the same list read-only (REQ-R04), same "one page,
 * role-conditional controls" pattern as /admin/calendar.
 */
const PAGE_SIZE = 20;

export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string; q?: string; page?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, error, q, page } = await searchParams;

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
  const isAdmin = actor.role === "ADMIN";

  const [semesters, academicYears, courses] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
    ]),
  );
  const yearLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };

  const offerings = semesterId ? await getOfferingsForSemester(actor, semesterId) : [];
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);

  const needle = q?.trim().toLowerCase();
  const filteredOfferings = needle
    ? offerings.filter((o) => {
        const c = courseFor(o.courseId);
        return (
          c?.code.toLowerCase().includes(needle) ||
          c?.title.toLowerCase().includes(needle) ||
          o.instructorName?.toLowerCase().includes(needle) ||
          o.section.toLowerCase().includes(needle)
        );
      })
    : offerings;

  const pageNum = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(filteredOfferings.length / PAGE_SIZE));
  const pagedOfferings = filteredOfferings.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

  // Only fetch meeting times for the offerings actually shown on this page
  // -- with a real semester's worth of offerings (150+), eagerly loading
  // every offering's meetings up front (one query per offering, previously
  // sequential) was the dominant cost on this page.
  const meetingsByOffering = await getOfferingMeetingsForOfferings(actor, pagedOfferings.map((o) => o.id));

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Course offerings" />

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
        <>
          {isAdmin && (
            <Card className="mb-6">
              <CardBody>
                <h2 className="mb-3 font-medium text-neutral-900">Add an offering</h2>
                <form action={createOfferingAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="semesterId" value={semesterId} />
                  <div>
                    <Label htmlFor="courseId" className="text-xs">
                      Course
                    </Label>
                    <Select id="courseId" name="courseId" required className="w-56">
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="section" className="text-xs">
                      Section
                    </Label>
                    <Input id="section" name="section" required placeholder="A" className="w-20" />
                  </div>
                  <div>
                    <Label htmlFor="instructorName" className="text-xs">
                      Instructor
                    </Label>
                    <Input id="instructorName" name="instructorName" className="w-40" />
                  </div>
                  <div>
                    <Label htmlFor="capacity" className="text-xs">
                      Capacity (optional)
                    </Label>
                    <Input id="capacity" name="capacity" type="number" min={1} className="w-24" />
                  </div>
                  <Button type="submit">Add offering</Button>
                </form>
              </CardBody>
            </Card>
          )}

          <section>
            <h2 className="mb-3 font-medium text-neutral-900">Offerings for {yearLabel(semesterId)}</h2>
            <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="semesterId" value={semesterId} />
              <div>
                <Label htmlFor="q" className="text-xs">
                  Search
                </Label>
                <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Course code, title, instructor, section" className="w-72" />
              </div>
              <Button type="submit" variant="secondary">
                Search
              </Button>
              {q && (
                <Link href={`/admin/offerings?semesterId=${semesterId}`} className="text-sm text-neutral-500 hover:underline">
                  Clear
                </Link>
              )}
            </form>
            {offerings.length === 0 && <p className="text-sm text-neutral-500">No offerings yet.</p>}
            {offerings.length > 0 && filteredOfferings.length === 0 && <p className="text-sm text-neutral-500">No offerings match this search.</p>}
            <div className="flex flex-col gap-4">
              {pagedOfferings.map((o) => {
                const c = courseFor(o.courseId);
                const meetings = meetingsByOffering.get(o.id) ?? [];
                return (
                  <Card key={o.id}>
                    <CardBody>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium text-neutral-900">{c ? `${c.code} — ${c.title}` : o.courseId}</span>{" "}
                          <span className="text-sm text-neutral-500">Section {o.section}</span>
                        </div>
                        <Badge tone={o.status === "PUBLISHED" ? "success" : o.status === "CANCELLED" ? "danger" : "neutral"}>{o.status}</Badge>
                      </div>
                      <p className="mb-2 text-sm text-neutral-600">
                        {o.instructorName || "No instructor set"} — {o.frozenCreditHours} credit hours
                        {o.capacity ? ` — capacity ${o.capacity}` : ""}
                      </p>

                      {meetings.length > 0 && (
                        <table className="mb-2 w-full border-collapse text-xs">
                          <tbody>
                            {meetings.map((m) => (
                              <tr key={m.id} className="border-b border-neutral-100">
                                <td className="py-1 pr-2 text-neutral-700">{DAY_NAMES[m.dayOfWeek]}</td>
                                <td className="py-1 pr-2 text-neutral-700">
                                  {m.startTime}–{m.endTime}
                                </td>
                                <td className="py-1 pr-2 text-neutral-700">{m.room ?? ""}</td>
                                {isAdmin && (
                                  <td className="py-1">
                                    <form action={removeMeetingAction}>
                                      <input type="hidden" name="semesterId" value={semesterId} />
                                      <input type="hidden" name="meetingId" value={m.id} />
                                      <button type="submit" className="font-medium text-danger-600 hover:underline">
                                        Remove
                                      </button>
                                    </form>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {isAdmin && (
                        <details className="mb-2">
                          <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">Add meeting time</summary>
                          <form action={addMeetingAction} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="semesterId" value={semesterId} />
                            <input type="hidden" name="offeringId" value={o.id} />
                            <div>
                              <Label className="text-xs">Day</Label>
                              <select name="dayOfWeek" required className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
                                {DAY_NAMES.slice(1).map((d, i) => (
                                  <option key={d} value={i + 1}>
                                    {d}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <Label className="text-xs">Start</Label>
                              <input name="startTime" type="time" required className="rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                            </div>
                            <div>
                              <Label className="text-xs">End</Label>
                              <input name="endTime" type="time" required className="rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                            </div>
                            <div>
                              <Label className="text-xs">Room</Label>
                              <input name="room" className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                            </div>
                            <Button type="submit" variant="secondary" size="sm">
                              Add
                            </Button>
                          </form>
                        </details>
                      )}

                      {isAdmin && (
                        <div className="flex flex-wrap items-center gap-3">
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">Edit instructor/capacity</summary>
                            <form action={updateOfferingAction} className="mt-2 flex flex-wrap items-end gap-2">
                              <input type="hidden" name="semesterId" value={semesterId} />
                              <input type="hidden" name="offeringId" value={o.id} />
                              <input name="instructorName" defaultValue={o.instructorName ?? ""} placeholder="Instructor" className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                              <input name="capacity" type="number" min={1} defaultValue={o.capacity ?? ""} placeholder="Capacity" className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-xs" />
                              <Button type="submit" variant="secondary" size="sm">
                                Save
                              </Button>
                            </form>
                          </details>
                          {o.status === "DRAFT" && (
                            <form action={publishOfferingAction}>
                              <input type="hidden" name="semesterId" value={semesterId} />
                              <input type="hidden" name="offeringId" value={o.id} />
                              <button type="submit" className="text-xs font-medium text-brand-700 hover:underline">
                                Publish
                              </button>
                            </form>
                          )}
                          {o.status !== "CANCELLED" && (
                            <form action={cancelOfferingAction}>
                              <input type="hidden" name="semesterId" value={semesterId} />
                              <input type="hidden" name="offeringId" value={o.id} />
                              <button type="submit" className="text-xs font-medium text-danger-600 hover:underline">
                                Cancel
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center gap-3 text-sm">
                {pageNum > 1 && (
                  <Link
                    href={`/admin/offerings?semesterId=${semesterId}&q=${encodeURIComponent(q ?? "")}&page=${pageNum - 1}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    Previous
                  </Link>
                )}
                <span className="text-neutral-600">
                  Page {pageNum} of {totalPages}
                </span>
                {pageNum < totalPages && (
                  <Link
                    href={`/admin/offerings?semesterId=${semesterId}&q=${encodeURIComponent(q ?? "")}&page=${pageNum + 1}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    Next
                  </Link>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
