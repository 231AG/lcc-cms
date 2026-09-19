import type { Metadata } from "next";
import Link from "next/link";
import { Download, Pencil, Printer, Trash2 } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { asUser } from "@/lib/db/asUser";
import { formatCourseCode } from "@/lib/courses/courseCode";
import {
  DAY_LETTER,
  DAY_NAMES,
  expandDays,
  filterOfferingRows,
  getOfferingRows,
  isOfferingSortColumn,
  sortOfferingRows,
} from "@/lib/offerings/offeringRows";
import { ACTIVE_SEMESTER_STATES, isOfferingEditable, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { ROOMS } from "@/lib/offerings/rooms";
import { DEFAULT_CAPACITY, DEFAULT_INSTRUCTOR } from "@/lib/offerings/offerings";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input, Select, Required } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td, SortableTh, type SortDirection } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import {
  addMeetingAction,
  cancelOfferingAction,
  createOfferingAction,
  publishOfferingAction,
  reinstateOfferingAction,
  rescheduleMeetingsAction,
  removeMeetingAction,
  updateOfferingAction,
} from "./actions";

export const metadata: Metadata = { title: "Course offerings" };

/**
 * Ten rows by default, not twenty-five.
 *
 * The pager sits under the table, so the page length decides how far you
 * scroll before you can reach it. Ten keeps the controls on screen with the
 * data. The picker is there for the case ten is wrong -- reading a whole
 * semester's timetable at once -- and matches the Students listing, which
 * already offers the same three sizes.
 */
const PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

/** Icon controls carry a tooltip and a matching accessible name. */
/**
 * How full a class is: seats taken, out of seats that exist, with the
 * students still waiting on a decision underneath.
 *
 * Pending is shown separately rather than folded into the total because the
 * two are different facts -- one is a student who has a place, the other is a
 * student who has asked for one. Adding them would tell an Admin a course is
 * full when it is not yet, and hide from them that it is about to be.
 *
 * The tone changes only at the point a decision is needed: amber once the
 * pending ones would fill it, red once the seats themselves are gone.
 */
function EnrolledCell({ enrolled, pending, capacity }: { enrolled: string; pending: string; capacity: string }) {
  const taken = Number(enrolled) || 0;
  const waiting = Number(pending) || 0;
  const seats = capacity === "" ? null : Number(capacity);

  const full = seats !== null && taken >= seats;
  const wouldFill = !full && seats !== null && taken + waiting >= seats;

  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className={full ? "font-semibold text-danger-fg" : wouldFill ? "font-semibold text-warning-fg" : undefined}>
        {taken}
        <span className="text-fg-muted"> / {seats === null ? "—" : seats}</span>
      </span>
      {waiting > 0 && <span className="text-xs whitespace-nowrap text-fg-muted">+{waiting} pending</span>}
    </span>
  );
}

const iconAction =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const iconDanger =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-surface hover:text-danger-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * A-08 (plan Section 20.4, Stage 8): the semester's offerings, sections and
 * meeting times.
 *
 * ONE TABLE FOR EVERY ROLE, laid out like the Students listing: search first
 * in the filter row, sortable headings, icon actions with tooltips, and
 * pagination under the table. The Admin's management controls hang off a
 * per-offering disclosure in the last column; a Super Admin sees the same
 * table with that column absent, and no other role can reach this page at all.
 *
 * A row is a TIMETABLE SLOT -- a room at a time, with its days collapsed into
 * "MWF" -- not a single meeting. See offeringRows.ts for why, and for why the
 * originally requested "Date" column is headed "Day".
 *
 * Choosing a semester fetches immediately (`data-auto-submit`), with the
 * button still there for the no-JavaScript path.
 */
/** The reference lists every view of this page needs, read as the signed-in
 *  user so RLS applies. Pulled out so the page can wrap it in one try. */
function loadReference(userId: string) {
  return asUser(userId, (tx) =>
    Promise.all([
      tx.query.semester.findMany(),
      tx.query.academicYear.findMany(),
      tx.query.course.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
      tx.query.college.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
    ]),
  );
}

/**
 * What this page shows instead of falling over.
 *
 * The plain message is for whoever hit it -- it says the page could not be
 * read and that this is not something they did wrong, which is all most
 * readers need. The technical detail is behind `?debug=1` rather than shown
 * to everyone: a student browsing the timetable has no use for a Postgres
 * error, and no business seeing one.
 */
function LoadFailure({ stage, err, debug }: { stage: string; err: unknown; debug: boolean }) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  // Logged unconditionally, so a deployment whose logs ARE readable has it
  // without anybody needing to know about the query parameter.
  console.error(`[offerings] failed while ${stage}:`, err);
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 outline-none sm:py-10">
      <PageHeader title="Course offerings" />
      <Alert tone="danger">
        <p className="font-medium">This page could not be loaded.</p>
        <p className="mt-1 text-sm">
          Something went wrong while {stage}. This is a fault in the system, not something you did. Please tell the
          registrar&rsquo;s office.
        </p>
      </Alert>
      {debug && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-semibold text-fg">Technical detail</p>
          <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-fg-secondary">{message}</pre>
          {stack && (
            <pre className="mt-2 overflow-x-auto text-[11px] whitespace-pre-wrap text-fg-muted">
              {stack.split("\n").slice(0, 8).join("\n")}
            </pre>
          )}
        </div>
      )}
    </main>
  );
}

export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    semesterId?: string;
    error?: string;
    q?: string;
    collegeId?: string;
    page?: string;
    sort?: string;
    dir?: string;
    pageSize?: string;
    /** `?debug=1` adds the technical detail to the error card below. */
    debug?: string;
  }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId: requestedSemesterId, error, q, collegeId, page, sort, dir, pageSize, debug } = await searchParams;
  // An unrecognised size falls back rather than erroring, so a hand-edited
  // URL cannot produce a page of 10,000 rows.
  const size = (PAGE_SIZES as readonly number[]).includes(Number(pageSize))
    ? Number(pageSize)
    : DEFAULT_PAGE_SIZE;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  // Students read this table too: for them it is the course catalogue, and
  // nothing more. Building a plan happens on /planning, which is the one
  // place that shows the plan, the running credit total and the Submit
  // button together -- an "Add to plan" button here was a second way to do
  // the same thing, on a page that could not show the consequence of
  // pressing it.
  const isAdmin = actor.role === "ADMIN";
  const isStudent = actor.role === "STUDENT";

  // Reading this page must not be able to produce a blank 500. A single
  // unreadable row or an unexpected null used to take the whole route down
  // with a message only the hosting platform's logs could show -- and on a
  // plan where those logs are not available, that is an error nobody can
  // diagnose. The reads are wrapped so a failure renders something a person
  // can act on, and `?debug=1` adds the technical detail for whoever is
  // actually fixing it.
  let semesters: Awaited<ReturnType<typeof loadReference>>[0];
  let academicYears: Awaited<ReturnType<typeof loadReference>>[1];
  let courses: Awaited<ReturnType<typeof loadReference>>[2];
  let colleges: Awaited<ReturnType<typeof loadReference>>[3];
  try {
    [semesters, academicYears, courses, colleges] = await loadReference(actor.userId);
  } catch (err) {
    return <LoadFailure stage="reading the semester and course lists" err={err} debug={debug === "1"} />;
  }
  const semesterLabel = (semId: string) => {
    const sem = semesters.find((s) => s.id === semId);
    const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
    return semesterFullLabel(year, sem, semId);
  };
  // Landing on an empty page and being asked to pick a semester is a step
  // nobody wants: the answer is almost always the semester currently being
  // taught or planned. "Most recently opened" is read off start_date among
  // the states that are open in the lifecycle sense (OPEN, IN_PROGRESS) --
  // not the newest semester overall, which could be a DRAFT for next year
  // that has no offerings in it yet. An explicit ?semesterId always wins,
  // and if nothing is open this falls back to the latest semester there is.
  const defaultSemester =
    [...semesters]
      .filter((s) => (ACTIVE_SEMESTER_STATES as readonly string[]).includes(s.state))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
    [...semesters].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const semesterId =
    (requestedSemesterId && semesters.find((s) => s.id === requestedSemesterId)?.id) ?? defaultSemester?.id ?? "";
  const selectedSemester = semesterId ? semesters.find((s) => s.id === semesterId) : undefined;
  const canManage = isAdmin && selectedSemester ? isOfferingEditable(selectedSemester.state as SemesterState) : false;

  let allRows: Awaited<ReturnType<typeof getOfferingRows>> = [];
  try {
    if (semesterId) allRows = await getOfferingRows(actor, semesterId);
  } catch (err) {
    return <LoadFailure stage="reading this semester's offerings" err={err} debug={debug === "1"} />;
  }
  const collegeLabel = collegeId ? colleges.find((c) => c.id === collegeId)?.name : undefined;
  const filtered = filterOfferingRows(allRows, q, collegeId, collegeLabel);

  // An unrecognised sort key falls back to course code rather than throwing:
  // these arrive from the URL, which anyone can edit.
  const sortColumn = isOfferingSortColumn(sort) ? sort : "code";
  const sortDirection: SortDirection = dir === "desc" ? "desc" : "asc";
  const rows = sortOfferingRows(filtered, sortColumn, sortDirection);

  const pageNum = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const pageRows = rows.slice((pageNum - 1) * size, pageNum * size);

  // An offering's slots sit on consecutive rows, so the management controls
  // are attached to the first slot of each offering -- repeating Publish and
  // Cancel beside every timetable slot would be the same buttons over and
  // over for one section.
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
    if (sortColumn !== "code") sp.set("sort", sortColumn);
    if (sortDirection !== "asc") sp.set("dir", sortDirection);
    if (size !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(size));
    for (const [k, v] of Object.entries(extra)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    return sp;
  };
  const hrefForPage = (p: number) => `/admin/offerings?${queryParams(p > 1 ? { page: String(p) } : {})}`;
  // Sorting always returns to page 1: staying on page 4 of a re-sorted table
  // shows a different set of rows than the one you were looking at.
  const hrefForSort = (column: string, direction: SortDirection) => {
    const sp = new URLSearchParams();
    if (semesterId) sp.set("semesterId", semesterId);
    if (q) sp.set("q", q);
    if (collegeId) sp.set("collegeId", collegeId);
    if (size !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(size));
    sp.set("sort", column);
    sp.set("dir", direction);
    return `/admin/offerings?${sp}`;
  };
  const exportHref = `/admin/offerings/export?${queryParams()}`;
  const printHref = `/admin/offerings/print?${queryParams()}`;
  const hasFilters = Boolean(q || collegeId);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 outline-none sm:py-10">
      <PageHeader title="Course offerings" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Search first, then the narrowing filters -- the same order as the
          Students listing, so the two screens are learned once. */}
      <Card className="mb-6 overflow-hidden">
        <form method="GET" className="flex flex-wrap items-end gap-2 px-4 py-3 sm:px-5">
          <div className="grow sm:grow-0">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Code, title, section, room, day" className="w-full sm:w-64" />
          </div>
          <div>
            <Label htmlFor="semesterId" className="text-xs">
              Semester
            </Label>
            {/* Fetches on choice -- no separate confirm step. The Search
                button is the no-JavaScript fallback. */}
            <Select id="semesterId" name="semesterId" defaultValue={semesterId ?? ""} className="w-56" data-auto-submit="">
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
                  {c.name}
                </option>
              ))}
            </Select>
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
                <form action={createOfferingAction}>
                  <input type="hidden" name="semesterId" value={semesterId} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="sm:col-span-2">
                      {/* A datalist rather than a select: at 177 courses a
                          dropdown is a scroll, and this is searchable by
                          code or title while still being a plain form
                          control that works with JavaScript off. What is
                          submitted is the code, which is unique. */}
                      <Label htmlFor="courseCode" className="text-xs">
                        Course
                        <Required />
                      </Label>
                      <Input
                        id="courseCode"
                        name="courseCode"
                        list="offering-course-options"
                        required
                        autoComplete="off"
                        placeholder="Type a code or title, e.g. ACCT 301"
                      />
                      {/* Offered spaced, matching the table and the grade
                          sheet. The code typed here is resolved with its
                          spaces removed, so either spelling is accepted --
                          which is the point: a code a reader can see is a
                          code they can type. */}
                      <datalist id="offering-course-options">
                        {courses.map((c) => (
                          <option key={c.id} value={formatCourseCode(c.code)}>
                            {c.title}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div>
                      {/* Sections are numbered, not lettered. */}
                      <Label htmlFor="section" className="text-xs">
                        Section
                        <Required />
                      </Label>
                      <Input id="section" name="section" required inputMode="numeric" placeholder="1" />
                    </div>
                    <div>
                      <Label htmlFor="room" className="text-xs">
                        Room
                        <Required />
                      </Label>
                      <Select id="room" name="room" required defaultValue="">
                        <option value="" disabled>
                          Select room
                        </option>
                        {ROOMS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="startTime" className="text-xs">
                        Start time
                        <Required />
                      </Label>
                      <Input id="startTime" name="startTime" type="time" required />
                    </div>
                    <div>
                      <Label htmlFor="endTime" className="text-xs">
                        End time
                        <Required />
                      </Label>
                      <Input id="endTime" name="endTime" type="time" required />
                    </div>
                    <div>
                      <Label htmlFor="instructorName" className="text-xs">
                        Instructor
                      </Label>
                      <Input id="instructorName" name="instructorName" placeholder={DEFAULT_INSTRUCTOR} />
                    </div>
                    <div>
                      <Label htmlFor="capacity" className="text-xs">
                        Capacity
                      </Label>
                      <Input id="capacity" name="capacity" type="number" min={1} placeholder={String(DEFAULT_CAPACITY)} />
                    </div>
                    <fieldset className="sm:col-span-2 lg:col-span-4">
                      {/* Checkboxes rather than a multiple-select: a
                          multi-select needs ctrl-click to pick a second
                          option, which is the kind of thing that quietly
                          produces one-day timetables. */}
                      <legend className="mb-1 block text-xs font-medium text-fg">
                        Days
                        <Required />
                      </legend>
                      <div className="flex flex-wrap gap-3">
                        {DAY_NAMES.slice(1).map((name, index) => (
                          <label key={name} className="flex items-center gap-1.5 text-sm text-fg">
                            <input
                              type="checkbox"
                              name="days"
                              value={index + 1}
                              className="h-4 w-4 rounded border-line-strong text-brand accent-[var(--color-brand)]"
                            />
                            {name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Button type="submit">Add offering</Button>
                    <p className="text-xs text-fg-muted">
                      Blank instructor becomes &ldquo;{DEFAULT_INSTRUCTOR}&rdquo;; blank capacity becomes {DEFAULT_CAPACITY}.
                    </p>
                  </div>
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
              <div className="flex flex-wrap items-center gap-1">
                <a href={exportHref} title="Download CSV" aria-label="Download CSV" className={iconAction}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
                <Link href={printHref} title="Print (PDF)" aria-label="Print (PDF)" className={iconAction}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
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
                    <SortableTh label="College" column="college" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="hidden 2xl:table-cell" />
                    <SortableTh label="Department" column="department" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="hidden lg:table-cell" />
                    <Th className="hidden 2xl:table-cell">Year</Th>
                    <Th className="hidden whitespace-nowrap 2xl:table-cell">Semester</Th>
                    <SortableTh label="Code" column="code" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="whitespace-nowrap" />
                    <SortableTh label="Course Title" column="title" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} />
                    <SortableTh label="Sec" column="section" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} />
                    <SortableTh label="Cr/Hrs" column="creditHours" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="hidden sm:table-cell" />
                    <SortableTh label="Room" column="room" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="hidden md:table-cell" />
                    <SortableTh label="Day" column="day" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} />
                    <SortableTh label="Start" column="startTime" activeColumn={sortColumn} direction={sortDirection} hrefFor={hrefForSort} className="whitespace-nowrap" />
                    <Th className="whitespace-nowrap">End</Th>
                    {/* Stays visible at every width, unlike Room or Cr/Hrs:
                        knowing whether a class is full is the reason most
                        people open this table on a phone. */}
                    <SortableTh
                      label="Enrolled"
                      column="enrolled"
                      activeColumn={sortColumn}
                      direction={sortDirection}
                      hrefFor={hrefForSort}
                      className="whitespace-nowrap text-center"
                    />
                    {/* Management is Admin-only, so a Super Admin's or a
                        student's view of this table has no Actions column at
                        all rather than an empty one. */}
                    {isAdmin && <Th className="text-right">Actions</Th>}
                  </tr>
                </Thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <Tr key={`${row.offeringId}-${row.day}-${row.startTime}-${i}`} className="align-top">
                      {/* Truncated with the full value on hover rather than
                          wrapping three lines deep and making every row tall. */}
                      <Td className="hidden text-xs text-fg-secondary 2xl:table-cell">
                        <span className="block max-w-[11rem] truncate" title={row.college}>
                          {row.college || "—"}
                        </span>
                      </Td>
                      <Td className="hidden text-xs text-fg-secondary lg:table-cell">
                        <span className="block max-w-[9rem] truncate" title={row.department}>
                          {row.department || "—"}
                        </span>
                      </Td>
                      <Td className="hidden whitespace-nowrap text-xs text-fg-secondary 2xl:table-cell">{row.year}</Td>
                      <Td className="hidden whitespace-nowrap text-xs text-fg-secondary 2xl:table-cell">{row.semester}</Td>
                      <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{row.code}</Td>
                      <Td className="min-w-[12rem] font-medium text-fg">
                        {row.title}
                        {/* Shown for every status, not only the unusual ones:
                            a published offering with no badge reads as "the
                            badge failed to render", not as "published".
                            Except to a student, whose RLS policy only ever
                            returns PUBLISHED rows -- one value repeated on
                            every row is not information. */}
                        {!isStudent && (
                          <Badge
                            tone={row.status === "PUBLISHED" ? "success" : row.status === "CANCELLED" ? "danger" : "neutral"}
                            className="ml-2"
                          >
                            {row.status}
                          </Badge>
                        )}
                      </Td>
                      <Td>{row.section}</Td>
                      <Td className="hidden sm:table-cell">{row.creditHours}</Td>
                      <Td className="hidden text-fg-secondary md:table-cell">{row.room || "—"}</Td>
                      {/* Timetable abbreviations, with the full day names on
                          hover so "TTh" is never a guess. */}
                      <Td className="whitespace-nowrap">
                        {row.day ? (
                          <span title={expandDays(row.day)}>{row.day}</span>
                        ) : (
                          <span className="text-fg-muted">Not scheduled</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{row.startTime || "—"}</Td>
                      <Td className="whitespace-nowrap">{row.endTime || "—"}</Td>
                      <Td className="whitespace-nowrap text-center">
                        <EnrolledCell enrolled={row.enrolled} pending={row.pending} capacity={row.capacity} />
                      </Td>
                      {isAdmin && (
                        <Td className="px-2 sm:px-3">
                          <span className="flex items-center justify-end gap-1">
                            {firstRowOfOffering.has(i) && (
                              <details className="relative">
                                <summary
                                  title={`Edit ${row.code} section ${row.section}`}
                                  aria-label={`Edit ${row.code} section ${row.section}`}
                                  className={`${iconAction} inline-flex cursor-pointer list-none`}
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </summary>
                                <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-surface-raised p-3 text-left shadow-lg">
                                  {canManage ? (
                                    <div className="flex flex-col gap-3">
                                      <form action={updateOfferingAction} className="flex flex-wrap items-end gap-2">
                                        <input type="hidden" name="semesterId" value={semesterId} />
                                        <input type="hidden" name="offeringId" value={row.offeringId} />
                                        <Input name="instructorName" defaultValue={row.instructor} placeholder="Instructor" className="w-36 py-1 text-xs" />
                                        <Input name="capacity" type="number" min={1} defaultValue={row.capacity} placeholder="Capacity" className="w-20 py-1 text-xs" />
                                        <Button type="submit" variant="secondary" size="sm">
                                          Save
                                        </Button>
                                      </form>

                                      {/* CHANGE this slot, as against adding
                                          another. Without it the only way to
                                          move a class from 11:00 to 12:00 was
                                          to add a second slot and delete the
                                          first -- and stopping half way
                                          leaves the offering on the timetable
                                          twice, which reads as the system
                                          having duplicated it. Days are not
                                          editable here: changing WHEN a class
                                          meets is this, changing WHICH DAYS
                                          is the add and remove below. */}
                                      {row.meetingIds && (
                                        <form action={rescheduleMeetingsAction} className="flex flex-wrap items-end gap-2">
                                          <input type="hidden" name="semesterId" value={semesterId} />
                                          <input type="hidden" name="meetingIds" value={row.meetingIds} />
                                          <span className="py-1 text-xs text-fg-muted" title={expandDays(row.day)}>
                                            Move {row.day}
                                          </span>
                                          <Input
                                            name="startTime"
                                            type="time"
                                            required
                                            defaultValue={row.startTime}
                                            className="w-24 py-1 text-xs"
                                            aria-label="New start time"
                                          />
                                          <Input
                                            name="endTime"
                                            type="time"
                                            required
                                            defaultValue={row.endTime}
                                            className="w-24 py-1 text-xs"
                                            aria-label="New end time"
                                          />
                                          <Select
                                            name="room"
                                            required
                                            defaultValue={row.room}
                                            className="w-24 py-1 text-xs"
                                            aria-label="New room"
                                          >
                                            {ROOMS.map((r) => (
                                              <option key={r} value={r}>
                                                {r}
                                              </option>
                                            ))}
                                          </Select>
                                          <Button type="submit" variant="secondary" size="sm">
                                            Change time
                                          </Button>
                                        </form>
                                      )}

                                      <form action={addMeetingAction} className="flex flex-wrap items-end gap-2">
                                        <input type="hidden" name="semesterId" value={semesterId} />
                                        <input type="hidden" name="offeringId" value={row.offeringId} />
                                        <Select name="dayOfWeek" required className="w-16 py-1 text-xs">
                                          {DAY_LETTER.slice(1).map((letter, index) => (
                                            <option key={letter} value={index + 1}>
                                              {letter}
                                            </option>
                                          ))}
                                        </Select>
                                        <Input name="startTime" type="time" required className="w-24 py-1 text-xs" />
                                        <Input name="endTime" type="time" required className="w-24 py-1 text-xs" />
                                        {/* Same fixed list as the create
                                            form -- a free-text room here is
                                            how "PAPE 1" and "Pape1" end up
                                            in the same timetable. */}
                                        <Select name="room" required defaultValue="" className="w-24 py-1 text-xs">
                                          <option value="" disabled>
                                            Room
                                          </option>
                                          {ROOMS.map((r) => (
                                            <option key={r} value={r}>
                                              {r}
                                            </option>
                                          ))}
                                        </Select>
                                        <Button type="submit" variant="secondary" size="sm">
                                          Add another day
                                        </Button>
                                      </form>

                                      {/* The lifecycle, and a way back from
                                          every state. Cancelling used to be
                                          a one-way door: Publish only ever
                                          showed for a DRAFT, so a cancelled
                                          offering could not be brought back
                                          and the class had to be recreated
                                          under another section number. */}
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
                                        {row.status === "CANCELLED" && (
                                          <form action={reinstateOfferingAction}>
                                            <input type="hidden" name="semesterId" value={semesterId} />
                                            <input type="hidden" name="offeringId" value={row.offeringId} />
                                            <button
                                              type="submit"
                                              title="Bring this offering back as a draft, then publish it"
                                              className="text-xs font-medium text-brand-fg hover:underline"
                                            >
                                              Reinstate as draft
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
                                    </div>
                                  ) : (
                                    <p className="text-xs text-fg-muted">
                                      Schedules are frozen once teaching starts — this semester is no longer editable.
                                    </p>
                                  )}
                                </div>
                              </details>
                            )}
                            {/* Deletes the whole slot this row shows, every
                                day of it -- see removeMeetingAction. */}
                            {canManage && row.meetingIds && (
                              <form action={removeMeetingAction}>
                                <input type="hidden" name="semesterId" value={semesterId} />
                                <input type="hidden" name="meetingIds" value={row.meetingIds} />
                                <button
                                  type="submit"
                                  title={`Delete the ${row.day} ${row.startTime}–${row.endTime} meeting`}
                                  aria-label={`Delete the ${expandDays(row.day)} ${row.startTime} to ${row.endTime} meeting for ${row.code} section ${row.section}`}
                                  className={iconDanger}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </form>
                            )}
                          </span>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            {/* Inside the card, under the table -- the Students listing puts
                its count and pager together the same way. */}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-4 py-3 sm:px-5">
                <p className="text-sm text-fg-secondary">
                  Showing {(pageNum - 1) * size + 1}&ndash;{Math.min(pageNum * size, rows.length)} of {rows.length}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <form method="GET" className="flex items-center gap-1.5">
                    {/* The current view rides along as hidden fields, so
                        changing the page length keeps the semester, search
                        and sort you were looking at. */}
                    {semesterId && <input type="hidden" name="semesterId" value={semesterId} />}
                    {q && <input type="hidden" name="q" value={q} />}
                    {collegeId && <input type="hidden" name="collegeId" value={collegeId} />}
                    {sort && <input type="hidden" name="sort" value={sort} />}
                    {dir && <input type="hidden" name="dir" value={dir} />}
                    <Label htmlFor="pageSize" className="mb-0 text-xs whitespace-nowrap">
                      Per page
                    </Label>
                    <Select id="pageSize" name="pageSize" defaultValue={String(size)} className="w-20 py-1 text-xs">
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary" size="sm">
                      Set
                    </Button>
                  </form>
                  <Pagination page={pageNum} totalPages={totalPages} hrefForPage={hrefForPage} label="Offerings pagination" />
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
