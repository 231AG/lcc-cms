import type { Metadata } from "next";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getOfferingRows, filterOfferingRows, DAY_SHORT, DAY_NAMES } from "@/lib/offerings/offeringRows";
import { isOfferingEditable, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import {
  addMeetingAction,
  cancelOfferingAction,
  createOfferingAction,
  publishOfferingAction,
  removeMeetingAction,
  updateOfferingAction,
} from "./actions";

export const metadata: Metadata = { title: "Course offerings" };

const PAGE_SIZE = 25;

/**
 * A-08 (plan Section 20.4, Stage 8): the semester's offerings, sections and
 * meeting times.
 *
 * ONE TABLE FOR EVERY ROLE. Admin and Super Admin used to get the same list
 * rendered as a stack of cards, with the Admin's controls interleaved; it is
 * now a single table with the twelve columns a timetable actually needs, and
 * the Admin's management controls hang off a per-offering disclosure in the
 * last column. Same data, same permissions, one view.
 *
 * A row is a MEETING, not an offering -- see offeringRows.ts for why, and
 * for why the requested "Date" column is headed "Day".
 *
 * Choosing a semester fetches immediately (`data-auto-submit`), with the
 * button still there for the no-JavaScript path.
 */
export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{ semesterId?: string; error?: string; q?: string; collegeId?: string; page?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId, error, q, collegeId, page } = await searchParams;

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

  const [semesters, academicYears, courses, colleges] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
      tx.query.college.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
    ]),
  );
  const semesterLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return sem && year ? `${year.label} — ${sem.name}` : semId;
  };
  const selectedSemester = semesterId ? semesters.find((s) => s.id === semesterId) : undefined;
  const canManage = isAdmin && selectedSemester ? isOfferingEditable(selectedSemester.state as SemesterState) : false;

  const allRows = semesterId ? await getOfferingRows(actor, semesterId) : [];
  const collegeLabel = collegeId ? (() => {
    const c = colleges.find((c) => c.id === collegeId);
    return c ? `${c.code} — ${c.name}` : undefined;
  })() : undefined;
  const rows = filterOfferingRows(allRows, q, collegeId, collegeLabel);

  const pageNum = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

  // Every offering's meetings sit on consecutive rows, so the management
  // controls are attached to the first row of each offering -- repeating
  // them beside every meeting time would be the same three buttons over
  // and over for one section.
  const firstRowOfOffering = new Set<number>();
  const seen = new Set<string>();
  pageRows.forEach((row, i) => {
    if (!seen.has(row.offeringId)) {
      seen.add(row.offeringId);
      firstRowOfOffering.add(i);
    }
  });

  const queryParams = (extra: Record<string, string | undefined> = {}) => {
    const sp = new URLSearchParams();
    if (semesterId) sp.set("semesterId", semesterId);
    if (q) sp.set("q", q);
    if (collegeId) sp.set("collegeId", collegeId);
    for (const [k, v] of Object.entries(extra)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    return sp;
  };
  const hrefForPage = (p: number) => `/admin/offerings?${queryParams(p > 1 ? { page: String(p) } : {})}`;
  const exportHref = `/admin/offerings/export?${queryParams()}`;
  const printHref = `/admin/offerings/print?${queryParams()}`;
  const hasFilters = Boolean(q || collegeId);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Course offerings" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-6 overflow-hidden">
        <form method="GET" className="flex flex-wrap items-end gap-2 px-4 py-3 sm:px-5">
          <div>
            <Label htmlFor="semesterId" className="text-xs">
              Semester
            </Label>
            {/* Fetches on choice -- no separate confirm step. The Select
                button below is the no-JavaScript fallback. */}
            <Select id="semesterId" name="semesterId" defaultValue={semesterId ?? ""} className="w-64" data-auto-submit="">
              <option value="">Select a semester…</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {semesterLabel(s.id)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="collegeId" className="text-xs">
              College
            </Label>
            <Select id="collegeId" name="collegeId" defaultValue={collegeId ?? ""} className="max-w-56" data-auto-submit="">
              <option value="">All colleges</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grow sm:grow-0">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Code, title, section, room, day" className="w-full sm:w-64" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {hasFilters && (
            <Link href={`/admin/offerings?semesterId=${semesterId ?? ""}`} className={buttonClasses("ghost", "md")}>
              Clear filters
            </Link>
          )}
        </form>
      </Card>

      {!semesterId ? (
        <p className="text-sm text-fg-muted">Choose a semester to see its offerings.</p>
      ) : (
        <>
          {canManage && (
            <Card className="mb-6">
              <CardBody>
                <h2 className="mb-3 font-medium text-fg">Add an offering</h2>
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

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-4 py-4 sm:px-5">
              <div>
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {semesterLabel(semesterId)}
                  {selectedSemester && <SemesterStateBadge state={selectedSemester.state} />}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {rows.length} scheduled row{rows.length === 1 ? "" : "s"}
                  {hasFilters ? " matching the current filters" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href={exportHref} className="flex items-center gap-1.5 text-sm font-medium text-brand-fg hover:underline">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download CSV
                </a>
                <Link href={printHref} className="flex items-center gap-1.5 text-sm font-medium text-brand-fg hover:underline">
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  Print (PDF)
                </Link>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center sm:px-5">
                <p className="text-sm font-medium text-fg">No offerings found</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
                  {hasFilters
                    ? "No offering matches the current search and filters."
                    : canManage
                      ? "Nothing is offered in this semester yet. Use “Add an offering” above."
                      : "Nothing is offered in this semester yet."}
                </p>
              </div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    {/* The four context columns collapse first on a narrow
                        screen: on a phone you are looking up one class, and
                        you already know which semester you chose. */}
                    <Th className="hidden xl:table-cell">College</Th>
                    <Th className="hidden lg:table-cell">Department</Th>
                    <Th className="hidden xl:table-cell">Year</Th>
                    <Th className="hidden xl:table-cell">Semester</Th>
                    <Th className="whitespace-nowrap">Code</Th>
                    <Th>Course Title</Th>
                    <Th>Sec</Th>
                    <Th className="hidden sm:table-cell">Cr/Hrs</Th>
                    <Th className="hidden md:table-cell">Room</Th>
                    <Th>Day</Th>
                    <Th className="whitespace-nowrap">Start</Th>
                    <Th className="whitespace-nowrap">End</Th>
                    {isAdmin && <Th className="text-right">Manage</Th>}
                  </tr>
                </Thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <Tr key={`${row.offeringId}-${row.day}-${row.startTime}-${i}`} className="align-top">
                      <Td className="hidden text-xs text-fg-secondary xl:table-cell">{row.college || "—"}</Td>
                      <Td className="hidden text-xs text-fg-secondary lg:table-cell">{row.department || "—"}</Td>
                      <Td className="hidden whitespace-nowrap text-xs text-fg-secondary xl:table-cell">{row.year}</Td>
                      <Td className="hidden text-xs text-fg-secondary xl:table-cell">{row.semester}</Td>
                      <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{row.code}</Td>
                      <Td className="font-medium text-fg">
                        {row.title}
                        {/* Shown for every status, not only the unusual ones:
                            a published offering with no badge reads as "the
                            badge failed to render", not as "published". */}
                        <Badge
                          tone={row.status === "PUBLISHED" ? "success" : row.status === "CANCELLED" ? "danger" : "neutral"}
                          className="ml-2"
                        >
                          {row.status}
                        </Badge>
                      </Td>
                      <Td>{row.section}</Td>
                      <Td className="hidden sm:table-cell">{row.creditHours}</Td>
                      <Td className="hidden text-fg-secondary md:table-cell">{row.room || "—"}</Td>
                      {/* Full day name on wide screens, three letters on
                          narrow ones -- same value, no truncation. */}
                      <Td className="whitespace-nowrap">
                        {row.day ? (
                          <>
                            <span className="hidden lg:inline">{row.day}</span>
                            <span className="lg:hidden">{DAY_SHORT[DAY_NAMES.indexOf(row.day)]}</span>
                          </>
                        ) : (
                          <span className="text-fg-muted">Not scheduled</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{row.startTime || "—"}</Td>
                      <Td className="whitespace-nowrap">{row.endTime || "—"}</Td>
                      {isAdmin && (
                        <Td className="text-right">
                          {firstRowOfOffering.has(i) && (
                            <details className="text-left">
                              <summary className="cursor-pointer list-none text-xs font-medium text-brand-fg hover:underline">Manage</summary>
                              <div className="mt-2 flex flex-col gap-3">
                                {canManage ? (
                                  <>
                                    <form action={updateOfferingAction} className="flex flex-wrap items-end gap-2">
                                      <input type="hidden" name="semesterId" value={semesterId} />
                                      <input type="hidden" name="offeringId" value={row.offeringId} />
                                      <Input name="instructorName" defaultValue={row.instructor} placeholder="Instructor" className="w-40 py-1 text-xs" />
                                      <Input name="capacity" type="number" min={1} defaultValue={row.capacity} placeholder="Capacity" className="w-24 py-1 text-xs" />
                                      <Button type="submit" variant="secondary" size="sm">
                                        Save
                                      </Button>
                                    </form>

                                    <form action={addMeetingAction} className="flex flex-wrap items-end gap-2">
                                      <input type="hidden" name="semesterId" value={semesterId} />
                                      <input type="hidden" name="offeringId" value={row.offeringId} />
                                      <Select name="dayOfWeek" required className="w-24 py-1 text-xs">
                                        {DAY_SHORT.slice(1).map((d, index) => (
                                          <option key={d} value={index + 1}>
                                            {d}
                                          </option>
                                        ))}
                                      </Select>
                                      <Input name="startTime" type="time" required className="w-28 py-1 text-xs" />
                                      <Input name="endTime" type="time" required className="w-28 py-1 text-xs" />
                                      <Input name="room" placeholder="Room" className="w-24 py-1 text-xs" />
                                      <Button type="submit" variant="secondary" size="sm">
                                        Add meeting
                                      </Button>
                                    </form>

                                    <div className="flex flex-wrap items-center gap-3">
                                      {row.status === "DRAFT" && (
                                        <form action={publishOfferingAction}>
                                          <input type="hidden" name="semesterId" value={semesterId} />
                                          <input type="hidden" name="offeringId" value={row.offeringId} />
                                          <button type="submit" className="text-xs font-medium text-brand-fg hover:underline">
                                            Publish
                                          </button>
                                        </form>
                                      )}
                                      {row.status !== "CANCELLED" && (
                                        <form action={cancelOfferingAction}>
                                          <input type="hidden" name="semesterId" value={semesterId} />
                                          <input type="hidden" name="offeringId" value={row.offeringId} />
                                          <button type="submit" className="text-xs font-medium text-danger-fg hover:underline">
                                            Cancel offering
                                          </button>
                                        </form>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <p className="text-xs text-fg-muted">
                                    Schedules are frozen once teaching starts — this semester is no longer editable.
                                  </p>
                                )}
                              </div>
                            </details>
                          )}
                          {/* A meeting is removed from its own row, so there
                              is never any doubt which one is going. */}
                          {canManage && row.day && (
                            <form action={removeMeetingAction} className="mt-1">
                              <input type="hidden" name="semesterId" value={semesterId} />
                              <input type="hidden" name="meetingId" value={row.meetingId} />
                              <button type="submit" className="text-xs font-medium text-danger-fg hover:underline">
                                Remove
                              </button>
                            </form>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-secondary">
                Page {pageNum} of {totalPages}
              </p>
              <Pagination page={pageNum} totalPages={totalPages} hrefForPage={hrefForPage} label="Offerings pagination" />
            </div>
          )}
        </>
      )}
    </main>
  );
}
