import { asUser } from "@/lib/db/asUser";
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
  { key: "status", header: "Status", nowrap: true },
] as const;

/**
 * Timetable day letters, indexed by `offering_meeting.day_of_week` (1 = Monday
 * through 7 = Sunday). Thursday is "Th" and Sunday "Su" so neither collides
 * with Tuesday or Saturday when the letters run together -- "TTh" is
 * unambiguously Tuesday and Thursday, where "TT" would not be.
 */
export const DAY_LETTER = ["", "M", "T", "W", "Th", "F", "S", "Su"];

/** The full names, for a tooltip on the abbreviation. */
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "13:30:00" -> "13:30". Postgres `time` comes back with seconds nobody
 *  schedules a class to. */
function shortTime(value: string): string {
  return value.slice(0, 5);
}

/** The full day names behind an abbreviation like "MWF", for its tooltip. */
export function expandDays(abbreviation: string): string {
  if (!abbreviation) return "";
  const parts = abbreviation.match(/Th|Su|[MTWFS]/g) ?? [];
  return parts.map((p) => DAY_NAMES[DAY_LETTER.indexOf(p)] ?? p).join(", ");
}

export async function getOfferingRows(actor: Actor, semesterId: string): Promise<OfferingRow[]> {
  const offerings = await getOfferingsForSemester(actor, semesterId);
  if (offerings.length === 0) return [];

  // The reference tables are tens of rows and are read whole, once, rather
  // than joined per offering -- the same shape the rest of this app uses,
  // and what stops this page reintroducing the N+1 the performance pass
  // removed. Meetings come back in one batched query for the same reason.
  const [meetingsByOffering, reference] = await Promise.all([
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
      code: course?.code ?? "",
      title: course?.title ?? "",
      section: offering.section,
      creditHours: String(offering.frozenCreditHours),
      status: offering.status,
      instructor: offering.instructorName ?? "",
      capacity: offering.capacity === null ? "" : String(offering.capacity),
      offeringId: offering.id,
    };

    const meetings = meetingsByOffering.get(offering.id) ?? [];
    if (meetings.length === 0) {
      rows.push({ ...base, room: "", day: "", startTime: "", endTime: "", meetingIds: "" });
      continue;
    }

    // Group the offering's meetings into timetable slots: same room, same
    // start, same end. Insertion order is preserved by Map, and the meetings
    // arrive already sorted by day then start time, so a slot's days come out
    // in week order without a second sort.
    const slots = new Map<string, { room: string; start: string; end: string; days: number[]; ids: string[] }>();
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

    for (const slot of slots.values()) {
      rows.push({
        ...base,
        room: slot.room,
        day: [...slot.days].sort((a, b) => a - b).map((d) => DAY_LETTER[d] ?? "").join(""),
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
  return out.filter((r) =>
    [r.code, r.title, r.section, r.room, r.day, r.department, r.instructor, expandDays(r.day)].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}
