import { asUser } from "@/lib/db/asUser";
import { getOfferingMeetingsForOfferings, getOfferingsForSemester } from "./offerings";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * A semester's offerings as one flat table, shared by the screen, the CSV
 * download and the print view.
 *
 * ONE ROW PER MEETING, not per offering. Room, day and times are properties
 * of a meeting, and an offering can have several -- so a row-per-offering
 * table would either drop meetings or cram three of them into one cell. An
 * offering with no meetings scheduled yet still gets exactly one row, with
 * its schedule columns empty, so it is visibly on the timetable-to-be-made
 * list rather than missing.
 *
 * "Date" in the requested column list is the meeting DAY: offerings in this
 * system carry a weekly day-of-week plus start/end times (offering_meeting,
 * Section 9.4.8), not calendar dates. There is no per-date data to show, so
 * the column is headed "Day" rather than printing something that looks like
 * a date and is not one.
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
  day: string;
  startTime: string;
  endTime: string;
  /** DRAFT | PUBLISHED | CANCELLED -- shown on screen, included in exports. */
  status: string;
  instructor: string;
  capacity: string;
  /** Not columns; the screen needs these to attach the management controls
   *  to the right offering, and Remove to the right meeting. A row with no
   *  meeting has an empty meetingId, which is also how the screen knows
   *  there is nothing to remove. */
  offeringId: string;
  meetingId: string;
}

export const OFFERING_COLUMNS = [
  { key: "college", header: "College" },
  { key: "department", header: "Department" },
  { key: "year", header: "Year" },
  { key: "semester", header: "Semester" },
  { key: "code", header: "Course Code" },
  { key: "title", header: "Course Title" },
  { key: "section", header: "Section" },
  { key: "creditHours", header: "Cr/Hrs" },
  { key: "room", header: "Room" },
  { key: "day", header: "Day" },
  { key: "startTime", header: "Start Time" },
  { key: "endTime", header: "End Time" },
  { key: "instructor", header: "Instructor" },
  { key: "status", header: "Status" },
] as const;

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "13:30:00" -> "13:30". Postgres `time` comes back with seconds nobody
 *  schedules a class to. */
function shortTime(value: string): string {
  return value.slice(0, 5);
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
  const semesterName = semester?.name ?? "";

  const rows: OfferingRow[] = [];
  for (const offering of offerings) {
    const course = courses.find((c) => c.id === offering.courseId);
    const department = course ? departments.find((d) => d.id === course.departmentId) : undefined;
    const college = department ? colleges.find((c) => c.id === department.collegeId) : undefined;

    const base = {
      college: college ? `${college.code} — ${college.name}` : "",
      department: department ? `${department.code} — ${department.name}` : "",
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
      rows.push({ ...base, room: "", day: "", startTime: "", endTime: "", meetingId: "" });
      continue;
    }
    for (const meeting of meetings) {
      rows.push({
        ...base,
        room: meeting.room ?? "",
        day: DAY_NAMES[meeting.dayOfWeek] ?? "",
        startTime: shortTime(meeting.startTime),
        endTime: shortTime(meeting.endTime),
        meetingId: meeting.id,
      });
    }
  }

  // Course code, then section, then day -- how a printed timetable reads.
  // Rows with no meeting sort first within their offering, which is where
  // "this section still needs a schedule" belongs.
  return rows.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      a.section.localeCompare(b.section) ||
      DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day) ||
      a.startTime.localeCompare(b.startTime),
  );
}

/** Free-text search across everything a person would type looking for a
 *  class: code, title, section, room, and the day's name. */
export function filterOfferingRows(rows: OfferingRow[], query?: string, collegeId?: string, collegeLabel?: string): OfferingRow[] {
  let out = rows;
  if (collegeId && collegeLabel) out = out.filter((r) => r.college === collegeLabel);
  const needle = query?.trim().toLowerCase();
  if (!needle) return out;
  return out.filter((r) =>
    [r.code, r.title, r.section, r.room, r.day, r.department, r.instructor].some((value) => value.toLowerCase().includes(needle)),
  );
}
