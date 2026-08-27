import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetings, getOfferingsForSemester } from "@/lib/offerings/offerings";
import {
  addMeetingAction,
  cancelOfferingAction,
  createOfferingAction,
  publishOfferingAction,
  removeMeetingAction,
  updateOfferingAction,
} from "./actions";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A-08 (plan Section 20.4, Stage 8): the semester's offerings, sections,
 * instructors and meeting times. Admin creates/edits/publishes/cancels;
 * Super Admin sees the same list read-only (REQ-R04), same "one page,
 * role-conditional controls" pattern as /admin/calendar.
 */
export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, error } = await searchParams;

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
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
  const meetingsByOffering = new Map<string, Awaited<ReturnType<typeof getOfferingMeetings>>>();
  for (const o of offerings) {
    meetingsByOffering.set(o.id, await getOfferingMeetings(actor, o.id));
  }
  const courseFor = (courseId: string) => courses.find((c) => c.id === courseId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Course offerings</h1>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="semesterId" className="mb-1 block text-xs font-medium">
            Semester
          </label>
          <select
            id="semesterId"
            name="semesterId"
            defaultValue={semesterId ?? ""}
            className="w-72 rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">Select a semester…</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {yearLabel(s.id)} ({s.state})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
          Select
        </button>
      </form>

      {semesterId && (
        <>
          {isAdmin && (
            <section className="mb-6 rounded border border-gray-200 p-4">
              <h2 className="mb-3 font-medium">Add an offering</h2>
              <form action={createOfferingAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="semesterId" value={semesterId} />
                <div>
                  <label htmlFor="courseId" className="mb-1 block text-xs font-medium">
                    Course
                  </label>
                  <select id="courseId" name="courseId" required className="w-56 rounded border border-gray-300 px-2 py-1 text-sm">
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="section" className="mb-1 block text-xs font-medium">
                    Section
                  </label>
                  <input id="section" name="section" required placeholder="A" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                </div>
                <div>
                  <label htmlFor="instructorName" className="mb-1 block text-xs font-medium">
                    Instructor
                  </label>
                  <input id="instructorName" name="instructorName" className="w-40 rounded border border-gray-300 px-2 py-1 text-sm" />
                </div>
                <div>
                  <label htmlFor="capacity" className="mb-1 block text-xs font-medium">
                    Capacity (optional)
                  </label>
                  <input id="capacity" name="capacity" type="number" min={1} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
                </div>
                <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
                  Add offering
                </button>
              </form>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-medium">Offerings for {yearLabel(semesterId)}</h2>
            {offerings.length === 0 && <p className="text-sm text-gray-500">No offerings yet.</p>}
            <div className="flex flex-col gap-4">
              {offerings.map((o) => {
                const c = courseFor(o.courseId);
                const meetings = meetingsByOffering.get(o.id) ?? [];
                return (
                  <div key={o.id} className="rounded border border-gray-200 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">
                          {c ? `${c.code} — ${c.title}` : o.courseId}
                        </span>{" "}
                        <span className="text-sm text-gray-500">Section {o.section}</span>
                      </div>
                      <span className="text-xs font-medium uppercase text-gray-500">{o.status}</span>
                    </div>
                    <p className="mb-2 text-sm text-gray-600">
                      {o.instructorName || "No instructor set"} — {o.frozenCreditHours} credit hours
                      {o.capacity ? ` — capacity ${o.capacity}` : ""}
                    </p>

                    <table className="mb-2 w-full border-collapse text-xs">
                      <tbody>
                        {meetings.map((m) => (
                          <tr key={m.id} className="border-b">
                            <td className="py-1">{DAY_NAMES[m.dayOfWeek]}</td>
                            <td className="py-1">
                              {m.startTime}–{m.endTime}
                            </td>
                            <td className="py-1">{m.room ?? ""}</td>
                            {isAdmin && (
                              <td className="py-1">
                                <form action={removeMeetingAction}>
                                  <input type="hidden" name="semesterId" value={semesterId} />
                                  <input type="hidden" name="meetingId" value={m.id} />
                                  <button type="submit" className="text-red-700 underline">Remove</button>
                                </form>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {isAdmin && (
                      <details className="mb-2">
                        <summary className="cursor-pointer text-xs text-blue-700 underline">Add meeting time</summary>
                        <form action={addMeetingAction} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="semesterId" value={semesterId} />
                          <input type="hidden" name="offeringId" value={o.id} />
                          <div>
                            <label className="mb-1 block text-xs font-medium">Day</label>
                            <select name="dayOfWeek" required className="rounded border border-gray-300 px-2 py-1 text-xs">
                              {DAY_NAMES.slice(1).map((d, i) => (
                                <option key={d} value={i + 1}>{d}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Start</label>
                            <input name="startTime" type="time" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">End</label>
                            <input name="endTime" type="time" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Room</label>
                            <input name="room" className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
                          </div>
                          <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium">Add</button>
                        </form>
                      </details>
                    )}

                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-3">
                        <details>
                          <summary className="cursor-pointer text-xs text-blue-700 underline">Edit instructor/capacity</summary>
                          <form action={updateOfferingAction} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="semesterId" value={semesterId} />
                            <input type="hidden" name="offeringId" value={o.id} />
                            <input name="instructorName" defaultValue={o.instructorName ?? ""} placeholder="Instructor" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
                            <input name="capacity" type="number" min={1} defaultValue={o.capacity ?? ""} placeholder="Capacity" className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
                            <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-xs font-medium">Save</button>
                          </form>
                        </details>
                        {o.status === "DRAFT" && (
                          <form action={publishOfferingAction}>
                            <input type="hidden" name="semesterId" value={semesterId} />
                            <input type="hidden" name="offeringId" value={o.id} />
                            <button type="submit" className="text-xs text-blue-700 underline">Publish</button>
                          </form>
                        )}
                        {o.status !== "CANCELLED" && (
                          <form action={cancelOfferingAction}>
                            <input type="hidden" name="semesterId" value={semesterId} />
                            <input type="hidden" name="offeringId" value={o.id} />
                            <button type="submit" className="text-xs text-red-700 underline">Cancel</button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
