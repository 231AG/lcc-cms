import { and, eq, inArray, sql } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { db } from "@/lib/db/client";
import { coursePlan, coursePlanItem, registration } from "@/lib/db/schema";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { getOfferingMeetingsForOfferings, getOfferingsForSemester } from "./offerings";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * A semester's offerings as one flat table, shared by the screen, the CSV
 * download and the print view.
 *
 * ONE ROW PER TIMETABLE SLOT. A slot is a room and a time that an offering
 * meets at, and the days it meets on are collapsed into it the way a printed
 * timetable writes them: BIOL 205 meeting Monday, Wednesday and Friday at
 * 09:00-10:30 in B4 is one row reading "MWF", not three rows. Two meetings of
 * the same offering at different times stay two rows, because they are two
 * different things to be in a room for.
 *
 * An offering with nothing scheduled yet still gets exactly one row, with its
 * schedule columns empty, so it is visibly on the timetable-to-be-made list
 * rather than missing.
 *
 * "Date" in the originally requested column list is the meeting DAY:
 * offerings in this system carry a weekly day-of-week plus start/end times
 * (offering_meeting, Section 9.4.8), not calendar dates. There is no per-date
 * data to show, so the column is headed "Day" rather than printing something
 * that looks like a date and is not one.
 */

export interface OfferingRow {
  [column: string]: string;
  college: string;
  department: string;
  year: string;
  semester: string;
  code: string;
  title: string;
  section: string;
  creditHours: string;
  room: string;
  /** "MWF", "TTh", "S" -- the days this slot meets, in week order. */
  day: string;
  startTime: string;
  endTime: string;
  /** DRAFT | PUBLISHED | CANCELLED -- shown on screen, included in exports. */
  status: string;
  instructor: string;
  capacity: string;
  /** Students holding a seat: an approved plan that became a registration. */
  enrolled: string;
  /** Students who have asked for a seat and are waiting on a decision --
   *  an undecided item in a plan that has been submitted. Counted because a
   *  course fills during the week its registrations do not exist yet. */
  pending: string;
  /** Not columns; the screen needs these to attach the management controls to
   *  the right offering, and Remove to the right meetings. `meetingIds` is
   *  comma-separated because a row can now cover several meetings -- removing
   *  the "MWF" slot removes all three. Empty when nothing is scheduled. */
  offeringId: string;
  meetingIds: string;
}

/** `nowrap` marks the short columns, so only the free-text ones wrap when
 *  the table is printed. */
export const OFFERING_COLUMNS = [
  { key: "college", header: "College" },
  { key: "department", header: "Department" },
  { key: "year", header: "Year", nowrap: true },
  { key: "semester", header: "Semester", nowrap: true },
  { key: "code", header: "Course Code", nowrap: true },
  { key: "title", header: "Course Title" },
  { key: "section", header: "Sec", nowrap: true },
  { key: "creditHours", header: "Cr/Hrs", nowrap: true },
  { key: "room", header: "Room", nowrap: true },
  { key: "day", header: "Day", nowrap: true },
  { key: "startTime", header: "Start Time", nowrap: true },
  { key: "endTime", header: "End Time", nowrap: true },
  { key: "instructor", header: "Instructor", nowrap: true },
  { key: "enrolled", header: "Enrolled", nowrap: true },
  { key: "pending", header: "Pending", nowrap: true },
  { key: "capacity", header: "Capacity", nowrap: true },
  { key: "status", header: "Status", nowrap: true },
] as const;

/**
 * Timetable day letters, indexed by `offering_meeting.day_of_week` (1 = Monday
 * through 7 = Sunday). Thursday is "Th" and Sunday "Su" so neither collides
 * with Tuesday or Saturday when the letters run together -- "TTh" is
 * unambiguously Tuesday and Thursday, where "TT" would not be.
 */
export const DAY_LETTER = ["", "M", "T", "W", "Th", "F", "S", "Su"];

/** Three-letter forms, used when a slot meets on exactly two days. */
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The full names: the one-day form, and the tooltip behind an abbreviation. */
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * How a slot's days are written, which depends on how many there are.
 *
 * Three or more run together as letters ("MWF"), which is how a printed
 * timetable writes a standard weekly pattern and how staff already read one.
 * Two are spelled as three-letter names separated by a comma ("Mon, Wed") --
 * a two-letter run like "MW" is short enough to be misread as one token, and
 * there is room for the clearer form. One is spelled out in full ("Monday"),
 * because a lone abbreviation saves nothing and costs a moment's decoding.
 *
 * Days arrive in week order and are kept that way: "Mon, Wed" not "Wed, Mon".
 */
export function formatDays(days: number[]): string {
  const ordered = [...days].sort((a, b) => a - b);
  if (ordered.length === 0) return "";
  if (ordered.length === 1) return DAY_NAMES[ordered[0]] ?? "";
  if (ordered.length === 2) return ordered.map((d) => DAY_SHORT[d] ?? "").join(", ");
  return ordered.map((d) => DAY_LETTER[d] ?? "").join("");
}

/** "13:30:00" -> "13:30". Postgres `time` comes back with seconds nobody
 *  schedules a class to. */
function shortTime(value: string): string {
  return value.slice(0, 5);
}

export interface MeetingSlot {
  room: string;
  start: string;
  end: string;
  days: number[];
  ids: string[];
}

/**
 * One offering's meetings, grouped into timetable slots: same room, same
 * start, same end. A course taught Monday, Wednesday and Friday at 11 in
 * PAPE 1 is ONE slot with three days, not three rows saying the same thing.
 *
 * Insertion order is preserved by Map and the meetings arrive already
 * sorted by day then start time, so a slot's days come out in week order
 * without a second sort.
 *
 * Extracted from buildOfferingRows below, which is where this logic lived
 * and still uses it -- the student's own screens need the same grouping to
 * show "when and where", and two copies would be two things to keep in
 * step.
 */
export function groupMeetingSlots(
  meetings: readonly { id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null }[],
): MeetingSlot[] {
  const slots = new Map<string, MeetingSlot>();
  for (const meeting of meetings) {
    const start = shortTime(meeting.startTime);
    const end = shortTime(meeting.endTime);
    const room = meeting.room ?? "";
    const key = `${room}|${start}|${end}`;
    const slot = slots.get(key) ?? { room, start, end, days: [], ids: [] };
    slot.days.push(meeting.dayOfWeek);
    slot.ids.push(meeting.id);
    slots.set(key, slot);
  }
  return [...slots.values()];
}

/**
 * The same slots as one human line each: "MWF 11:00-12:00 - PAPE 1".
 *
 * Returns an empty array when nothing is scheduled, so a caller renders
 * nothing rather than an empty-looking "TBA" it has no basis for.
 */
export function formatMeetingSlots(
  meetings: readonly { id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null }[],
): string[] {
  return groupMeetingSlots(meetings).map((slot) => {
    const when = `${formatDays(slot.days)} ${slot.start}\u2013${slot.end}`.trim();
    return slot.room ? `${when} \u00b7 ${slot.room}` : when;
  });
}

/**
 * The full day names behind whatever `formatDays` produced, for a tooltip.
 *
 * The two- and one-day forms are already full or near-full words, so this
 * only has real work to do on the concatenated three-or-more form; the
 * others are normalised to full names so every tooltip reads the same way.
 */
export function expandDays(formatted: string): string {
  if (!formatted) return "";
  if (formatted.includes(",")) {
    return formatted
      .split(",")
      .map((part) => DAY_NAMES[DAY_SHORT.indexOf(part.trim())] ?? part.trim())
      .join(", ");
  }
  if (DAY_NAMES.includes(formatted)) return formatted;
  const parts = formatted.match(/Th|Su|[MTWFS]/g) ?? [];
  return parts.map((p) => DAY_NAMES[DAY_LETTER.indexOf(p)] ?? p).join(", ");
}

/**
 * How many students hold a seat in each offering, and how many are waiting
 * on one.
 *
 * THIS READS THROUGH THE RAW CONNECTION, NOT asUser, AND THAT IS DELIBERATE.
 * Row-level security on `registration` is "your own rows, or ADMIN":
 *
 *     USING (current_user_role() = 'ADMIN' OR student_id = auth.uid())
 *
 * Counted through RLS, a student would count only themselves, and -- less
 * obviously -- a SUPER_ADMIN would count zero, because that policy names
 * ADMIN and not the role above it. The column would then show three
 * different wrong numbers to three different readers, quietly. Plan
 * validation already reads this way for exactly this reason (see the note in
 * submitPlan about cross-student visibility RLS cannot grant).
 *
 * What leaves this function is two integers per offering. No student id, no
 * name, nothing about who is in the class -- only how many.
 */
async function getEnrolmentCounts(offeringIds: string[]): Promise<Map<string, { enrolled: number; pending: number }>> {
  const counts = new Map<string, { enrolled: number; pending: number }>();
  if (offeringIds.length === 0) return counts;

  const [registered, awaiting] = await Promise.all([
    db
      .select({ offeringId: registration.offeringId, n: sql<number>`count(*)::int` })
      .from(registration)
      .where(and(inArray(registration.offeringId, offeringIds), eq(registration.status, "REGISTERED")))
      .groupBy(registration.offeringId),
    // An undecided item in a SUBMITTED plan. A DRAFT plan is a student still
    // making up their mind and claims nothing; an item already APPROVED has
    // become a registration and would otherwise be counted twice.
    db
      .select({ offeringId: coursePlanItem.offeringId, n: sql<number>`count(*)::int` })
      .from(coursePlanItem)
      .innerJoin(coursePlan, eq(coursePlanItem.planId, coursePlan.id))
      .where(
        and(
          inArray(coursePlanItem.offeringId, offeringIds),
          eq(coursePlanItem.status, "PENDING"),
          eq(coursePlan.status, "SUBMITTED"),
        ),
      )
      .groupBy(coursePlanItem.offeringId),
  ]);

  for (const id of offeringIds) counts.set(id, { enrolled: 0, pending: 0 });
  for (const r of registered) counts.set(r.offeringId, { ...counts.get(r.offeringId)!, enrolled: r.n });
  for (const r of awaiting) counts.set(r.offeringId, { ...counts.get(r.offeringId)!, pending: r.n });
  return counts;
}

export async function getOfferingRows(actor: Actor, semesterId: string): Promise<OfferingRow[]> {
  const offerings = await getOfferingsForSemester(actor, semesterId);
  if (offerings.length === 0) return [];

  // The reference tables are tens of rows and are read whole, once, rather
  // than joined per offering -- the same shape the rest of this app uses,
  // and what stops this page reintroducing the N+1 the performance pass
  // removed. Meetings come back in one batched query for the same reason.
  const [meetingsByOffering, reference, enrolmentCounts] = await Promise.all([
    getOfferingMeetingsForOfferings(
      actor,
      offerings.map((o) => o.id),
    ),
    asUser(actor.userId, (tx) =>
      Promise.all([
        tx.query.course.findMany(),
        tx.query.department.findMany(),
        tx.query.college.findMany(),
        tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, semesterId) }),
        tx.query.academicYear.findMany(),
      ]),
    ),
    // One grouped query for the whole page, not one per row -- this page had
    // an N+1 removed once already.
    getEnrolmentCounts(offerings.map((o) => o.id)),
  ]);
  const [courses, departments, colleges, semester, years] = reference;

  const yearLabel = semester ? (years.find((y) => y.id === semester.academicYearId)?.label ?? "") : "";
  const semesterName = semester ? semesterDisplayName(semester) : "";

  const rows: OfferingRow[] = [];
  for (const offering of offerings) {
    const course = courses.find((c) => c.id === offering.courseId);
    const department = course ? departments.find((d) => d.id === course.departmentId) : undefined;
    const college = department ? colleges.find((c) => c.id === department.collegeId) : undefined;

    const base = {
      // Names without their codes, matching the Students listing: the code is
      // an internal key, and repeating it on every row is noise to read past.
      college: college?.name ?? "",
      department: department?.name ?? "",
      year: yearLabel,
      semester: semesterName,
      // Shown spaced, matched unspaced -- see courseCodeKey. The grade
      // sheet already reads "CECS 201"; this is the same code on the
      // same screen, so it should not read "CECS201" here.
      code: course ? formatCourseCode(course.code) : "",
      title: course?.title ?? "",
      section: offering.section,
      creditHours: String(offering.frozenCreditHours),
      status: offering.status,
      instructor: offering.instructorName ?? "",
      capacity: offering.capacity === null ? "" : String(offering.capacity),
      enrolled: String(enrolmentCounts.get(offering.id)?.enrolled ?? 0),
      pending: String(enrolmentCounts.get(offering.id)?.pending ?? 0),
      offeringId: offering.id,
    };

    const meetings = meetingsByOffering.get(offering.id) ?? [];
    if (meetings.length === 0) {
      rows.push({ ...base, room: "", day: "", startTime: "", endTime: "", meetingIds: "" });
      continue;
    }

    for (const slot of groupMeetingSlots(meetings)) {
      rows.push({
        ...base,
        room: slot.room,
        day: formatDays(slot.days),
        startTime: slot.start,
        endTime: slot.end,
        meetingIds: slot.ids.join(","),
      });
    }
  }

  return sortOfferingRows(rows, "code", "asc");
}

/** The columns a reader can sort the offerings table by. */
export const SORTABLE_OFFERING_COLUMNS = [
  "college",
  "department",
  "code",
  "title",
  "section",
  "creditHours",
  "room",
  "day",
  "startTime",
  "enrolled",
] as const;
export type OfferingSortColumn = (typeof SORTABLE_OFFERING_COLUMNS)[number];

export function isOfferingSortColumn(value: string | undefined): value is OfferingSortColumn {
  return !!value && (SORTABLE_OFFERING_COLUMNS as readonly string[]).includes(value);
}

/**
 * Sorting, with course code + section + time as the tie-break under whatever
 * column was picked -- so sorting by Room does not scramble a room's classes
 * into a random order within it, which is the thing that makes a sorted table
 * useless.
 */
export function sortOfferingRows(rows: OfferingRow[], column: OfferingSortColumn, direction: "asc" | "desc"): OfferingRow[] {
  const factor = direction === "asc" ? 1 : -1;
  const compare = (a: OfferingRow, b: OfferingRow, key: OfferingSortColumn): number => {
    // Credit hours are a number in a string column; comparing them as text
    // would put "10" before "3".
    if (key === "creditHours") return Number(a[key] || 0) - Number(b[key] || 0);
    // Sorted by how full a class is, which is the question this column exists
    // to answer -- and by the seats claimed, not just the seats taken, since
    // the pending ones are about to become taken.
    if (key === "enrolled") {
      return Number(a.enrolled || 0) + Number(a.pending || 0) - (Number(b.enrolled || 0) + Number(b.pending || 0));
    }
    // An unscheduled row sorts last on the schedule columns rather than
    // first, where an empty string would otherwise put it.
    if ((key === "day" || key === "startTime" || key === "room") && a[key] !== b[key]) {
      if (!a[key]) return 1;
      if (!b[key]) return -1;
    }
    return a[key].localeCompare(b[key], undefined, { numeric: true });
  };

  return [...rows].sort(
    (a, b) =>
      compare(a, b, column) * factor ||
      a.code.localeCompare(b.code, undefined, { numeric: true }) ||
      a.section.localeCompare(b.section, undefined, { numeric: true }) ||
      a.startTime.localeCompare(b.startTime),
  );
}

/** Free-text search across everything a person would type looking for a
 *  class: code, title, section, room, instructor, department and the day. */
export function filterOfferingRows(rows: OfferingRow[], query?: string, collegeId?: string, collegeLabel?: string): OfferingRow[] {
  let out = rows;
  if (collegeId && collegeLabel) out = out.filter((r) => r.college === collegeLabel);
  const needle = query?.trim().toLowerCase();
  if (!needle) return out;
  // A code is matched with its spaces removed on BOTH sides, so "CECS 201",
  // "cecs201" and "CECS  201" all find the same course however it happens to
  // be stored. Everything else is plain substring matching.
  const codeNeedle = courseCodeKey(needle);
  return out.filter(
    (r) =>
      courseCodeKey(r.code).includes(codeNeedle) ||
      [r.title, r.section, r.room, r.day, r.department, r.instructor, expandDays(r.day)].some((value) =>
        value.toLowerCase().includes(needle),
      ),
  );
}
