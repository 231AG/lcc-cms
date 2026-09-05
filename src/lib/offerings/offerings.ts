import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { course, courseOffering, offeringMeeting, registration, semester } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { StateError, ValidationError } from "@/lib/errors";
import { isRoom } from "./rooms";
import {
  isOfferingEditable,
  SEMESTER_STATE_LABEL,
  SEMESTER_STATES,
  type SemesterState,
} from "@/lib/academic/semesterStateMachine";

/**
 * Offerings and schedules can only be created or edited before the term
 * starts -- Draft or Open under the four-state model (Section 13.4:
 * "Refuse; schedules are frozen once teaching starts"). From In Progress
 * onward, changes go through the audited late add/drop path instead.
 * Derived from the state machine rather than restated, and kept as an
 * array so the refusal message below can name the states.
 */
const EDITABLE_SEMESTER_STATES: SemesterState[] = SEMESTER_STATES.filter(isOfferingEditable);

async function assertSemesterEditable(semesterId: string): Promise<void> {
  const sem = await db.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");
  if (!EDITABLE_SEMESTER_STATES.includes(sem.state as SemesterState)) {
    throw new StateError(
      `Offerings can only be created or edited while the semester is ${EDITABLE_SEMESTER_STATES.map((st) => SEMESTER_STATE_LABEL[st]).join(" or ")} ` +
        `-- this one is ${SEMESTER_STATE_LABEL[sem.state as SemesterState]}, and schedules are frozen once teaching starts.`,
    );
  }
}

function normalizeSection(section: string): string {
  return section.trim().toUpperCase();
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// Offering CRUD (Section 9.4.7)
// ---------------------------------------------------------------------------

export interface CreateOfferingInput {
  semesterId: string;
  /** Either this, or `courseCode` -- the form submits the code, because a
   *  code is what a searchable picker can actually be searched by. */
  courseId?: string;
  courseCode?: string;
  section: string;
  /** Blank becomes DEFAULT_INSTRUCTOR. */
  instructorName?: string;
  /** Omitted becomes DEFAULT_CAPACITY. */
  capacity?: number;
  /** Weekday numbers, 1 = Monday. At least one is required: an offering is
   *  created with its schedule, not scheduled afterwards. */
  days?: number[];
  /** Must be one of ROOMS. */
  room?: string;
  startTime?: string;
  endTime?: string;
}

/** An offering created with no capacity given seats this many. A number the
 *  registrar can change per offering; what it is not is NULL, which used to
 *  mean "unlimited" and was almost never what anyone intended. */
export const DEFAULT_CAPACITY = 30;

/** ...and one created with no named instructor is taught by "Staff", the
 *  same placeholder a printed timetable uses before an assignment is made. */
export const DEFAULT_INSTRUCTOR = "Staff";

export async function createOffering(actor: Actor, input: CreateOfferingInput) {
  await assertCan(actor, "offering.manage");
  await assertSemesterEditable(input.semesterId);

  // The picker is a datalist, so what arrives is the course CODE typed or
  // chosen by the user. Codes are unique case-insensitively (0011's
  // course_code_unique_idx on lower(trim(code))), so this resolves to at
  // most one course -- and matching the same way the index does means a
  // code that looks right to the user is never rejected over its casing.
  const wantedCode = input.courseCode?.trim().toLowerCase();
  const courseRow = input.courseId
    ? await db.query.course.findFirst({ where: eq(course.id, input.courseId) })
    : wantedCode
      ? (await db.query.course.findMany()).find((c) => c.code.trim().toLowerCase() === wantedCode)
      : undefined;
  if (!courseRow) {
    throw new ValidationError(
      input.courseCode ? `No course with the code "${input.courseCode.trim()}".` : "Course not found.",
    );
  }
  if (!courseRow.isActive) throw new ValidationError("Cannot create an offering for an inactive course.");

  const section = normalizeSection(input.section);
  if (!section) throw new ValidationError("Section is required.");
  if (input.capacity !== undefined && input.capacity <= 0) {
    throw new ValidationError("Capacity must be a positive number.");
  }

  // The schedule is now part of creating an offering rather than a second
  // step afterwards: an offering with no time or room is not yet on
  // anybody's timetable, and the form that made one was the reason so many
  // of them sat unscheduled.
  const days = [...new Set(input.days ?? [])].sort((a, b) => a - b);
  if (days.length === 0) throw new ValidationError("Choose at least one day.");
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new ValidationError("Invalid day.");
  const room = input.room?.trim() ?? "";
  if (!isRoom(room)) throw new ValidationError("Choose a room.");
  if (!input.startTime || !input.endTime) throw new ValidationError("Start and end time are required.");
  if (input.endTime <= input.startTime) throw new ValidationError("End time must be after the start time.");

  const capacity = input.capacity ?? DEFAULT_CAPACITY;
  const instructorName = input.instructorName?.trim() || DEFAULT_INSTRUCTOR;

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(courseOffering)
        .values({
          semesterId: input.semesterId,
          courseId: courseRow.id,
          section,
          instructorName,
          capacity,
          status: "DRAFT",
          frozenCreditHours: courseRow.creditHours,
        })
        .returning();
      // One meeting row per chosen day, all sharing the room and time --
      // which is exactly the shape getOfferingRows collapses back into a
      // single "MWF" row.
      await tx.insert(offeringMeeting).values(
        days.map((dayOfWeek) => ({
          offeringId: row.id,
          dayOfWeek,
          startTime: input.startTime!,
          endTime: input.endTime!,
          room,
        })),
      );
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "OFFERING_CREATED",
        entityType: "course_offering",
        entityId: row.id,
        newValue: {
          semesterId: input.semesterId,
          courseCode: courseRow.code,
          section,
          instructorName: row.instructorName,
          capacity: row.capacity,
          days,
          room,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError(`Section "${section}" already exists for ${courseRow.code} in this semester.`);
    }
    throw err;
  }
}

export interface UpdateOfferingInput {
  instructorName?: string | null;
  capacity?: number | null;
}

export async function updateOffering(actor: Actor, offeringId: string, input: UpdateOfferingInput) {
  await assertCan(actor, "offering.manage");

  const existing = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
  if (!existing) throw new ValidationError("Offering not found.");
  await assertSemesterEditable(existing.semesterId);

  if (input.capacity !== undefined && input.capacity !== null && input.capacity <= 0) {
    throw new ValidationError("Capacity must be a positive number.");
  }

  const newInstructorName = input.instructorName === undefined ? existing.instructorName : input.instructorName?.trim() || null;
  const newCapacity = input.capacity === undefined ? existing.capacity : input.capacity;

  return asUser(actor.userId, async (tx) => {
    const [row] = await tx
      .update(courseOffering)
      .set({ instructorName: newInstructorName, capacity: newCapacity })
      .where(eq(courseOffering.id, offeringId))
      .returning();

    // Post-publication changes are specifically called out for audit
    // (Section 9.4.7: "students may already have planned around it") --
    // still audited before publication too, just without that note.
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "OFFERING_UPDATED",
      entityType: "course_offering",
      entityId: offeringId,
      oldValue: { instructorName: existing.instructorName, capacity: existing.capacity },
      newValue: { instructorName: newInstructorName, capacity: newCapacity },
      reason: existing.status === "PUBLISHED" ? "Change made after publication -- students may have already planned around it." : null,
    });

    return row;
  });
}

export async function publishOffering(actor: Actor, offeringId: string) {
  await assertCan(actor, "offering.manage");

  const existing = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
  if (!existing) throw new ValidationError("Offering not found.");
  await assertSemesterEditable(existing.semesterId);
  if (existing.status !== "DRAFT") {
    throw new StateError(`Only a Draft offering can be published (currently ${existing.status}).`);
  }

  const meetingCount = await db.query.offeringMeeting.findMany({ where: eq(offeringMeeting.offeringId, offeringId) });
  if (meetingCount.length === 0) {
    throw new ValidationError("Add at least one meeting time before publishing.");
  }

  return asUser(actor.userId, async (tx) => {
    const [row] = await tx
      .update(courseOffering)
      .set({ status: "PUBLISHED" })
      .where(eq(courseOffering.id, offeringId))
      .returning();
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "OFFERING_PUBLISHED",
      entityType: "course_offering",
      entityId: offeringId,
      oldValue: { status: "DRAFT" },
      newValue: { status: "PUBLISHED" },
    });
    return row;
  });
}

export async function cancelOffering(actor: Actor, offeringId: string) {
  await assertCan(actor, "offering.manage");

  const existing = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
  if (!existing) throw new ValidationError("Offering not found.");
  await assertSemesterEditable(existing.semesterId);
  if (existing.status === "CANCELLED") throw new StateError("This offering is already cancelled.");

  const activeRegistrations = await db.query.registration.findMany({
    where: and(eq(registration.offeringId, offeringId), eq(registration.status, "REGISTERED")),
  });
  if (activeRegistrations.length > 0) {
    throw new ValidationError(
      `Cannot cancel: ${activeRegistrations.length} student(s) are registered for this offering. Drop them first (DEC-14).`,
    );
  }

  return asUser(actor.userId, async (tx) => {
    const [row] = await tx
      .update(courseOffering)
      .set({ status: "CANCELLED" })
      .where(eq(courseOffering.id, offeringId))
      .returning();
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "OFFERING_CANCELLED",
      entityType: "course_offering",
      entityId: offeringId,
      oldValue: { status: existing.status },
      newValue: { status: "CANCELLED" },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Meeting times (Section 9.4.8)
// ---------------------------------------------------------------------------

export interface MeetingInput {
  dayOfWeek: number;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  room?: string;
}

/** Minutes since midnight, so comparisons are correct regardless of
 * whether a time string is "HH:MM" (as entered) or "HH:MM:SS" (as
 * Postgres's TIME type returns it) -- string comparison would silently
 * misorder those two formats right at exact boundary times. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function meetingsOverlap(a: MeetingInput, b: { dayOfWeek: number; startTime: string; endTime: string }): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

export async function addMeeting(actor: Actor, offeringId: string, input: MeetingInput) {
  await assertCan(actor, "offering.manage");

  const offering = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
  if (!offering) throw new ValidationError("Offering not found.");
  await assertSemesterEditable(offering.semesterId);

  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    throw new ValidationError("Day of week must be between 1 (Monday) and 7 (Sunday).");
  }
  if (timeToMinutes(input.endTime) <= timeToMinutes(input.startTime)) {
    throw new ValidationError("End time must be after start time.");
  }
  // The same fixed list the create form offers. Checked here rather than by
  // a database CHECK so meetings recorded before the list existed stay
  // valid -- see rooms.ts.
  if (!isRoom(input.room?.trim() ?? "")) throw new ValidationError("Choose a room.");

  const existingMeetings = await db.query.offeringMeeting.findMany({ where: eq(offeringMeeting.offeringId, offeringId) });
  const conflict = existingMeetings.find((m) => meetingsOverlap(input, m));
  if (conflict) {
    throw new ValidationError(
      `This meeting overlaps with an existing one for this offering (day ${conflict.dayOfWeek}, ${conflict.startTime}-${conflict.endTime}).`,
    );
  }

  return asUser(actor.userId, async (tx) => {
    const [row] = await tx
      .insert(offeringMeeting)
      .values({
        offeringId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        room: input.room?.trim() || null,
      })
      .returning();

    // Section 9.4.8's own audit line scopes this to changes made AFTER
    // publication -- pre-publication meeting setup is ordinary
    // construction, not yet something a student could have planned around.
    if (offering.status === "PUBLISHED") {
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "OFFERING_MEETING_CHANGED",
        entityType: "offering_meeting",
        entityId: row.id,
        newValue: { offeringId, dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, room: row.room },
        reason: "Meeting added after publication.",
      });
    }

    return row;
  });
}

export async function removeMeeting(actor: Actor, meetingId: string) {
  await assertCan(actor, "offering.manage");

  const existing = await db.query.offeringMeeting.findFirst({ where: eq(offeringMeeting.id, meetingId) });
  if (!existing) throw new ValidationError("Meeting not found.");
  const offering = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, existing.offeringId) });
  if (!offering) throw new ValidationError("Offering not found.");
  await assertSemesterEditable(offering.semesterId);

  return asUser(actor.userId, async (tx) => {
    await tx.delete(offeringMeeting).where(eq(offeringMeeting.id, meetingId));

    if (offering.status === "PUBLISHED") {
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "OFFERING_MEETING_CHANGED",
        entityType: "offering_meeting",
        entityId: meetingId,
        oldValue: { dayOfWeek: existing.dayOfWeek, startTime: existing.startTime, endTime: existing.endTime, room: existing.room },
        reason: "Meeting removed after publication.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Reads (RLS-scoped, not assertCan-gated -- Section 10.5)
// ---------------------------------------------------------------------------

export async function getOfferingsForSemester(actor: Actor, semesterId: string) {
  return asUser(actor.userId, (tx) =>
    tx.query.courseOffering.findMany({
      where: eq(courseOffering.semesterId, semesterId),
      orderBy: (o, { asc }) => asc(o.section),
    }),
  );
}

export async function getOfferingMeetings(actor: Actor, offeringId: string) {
  return asUser(actor.userId, (tx) =>
    tx.query.offeringMeeting.findMany({
      where: eq(offeringMeeting.offeringId, offeringId),
      orderBy: (m, { asc }) => [asc(m.dayOfWeek), asc(m.startTime)],
    }),
  );
}

/**
 * Batched form of getOfferingMeetings for a set of offerings -- one query
 * instead of one per offering, grouped in JS. Callers that used to loop
 * `for (const o of offerings) meetingsByOffering.set(o.id, await
 * getOfferingMeetings(...))` were opening a new asUser() transaction (a
 * full round trip to Supabase) per offering; with ~150 offerings in a real
 * semester that was the dominant cost on the offerings and plan-review
 * pages, not a missing index (course_offering.semester_id and
 * offering_meeting.offering_id both already have one, migration 0015).
 */
export async function getOfferingMeetingsForOfferings(actor: Actor, offeringIds: string[]) {
  const meetingsByOffering = new Map<string, Awaited<ReturnType<typeof getOfferingMeetings>>>();
  if (offeringIds.length === 0) return meetingsByOffering;
  const meetings = await asUser(actor.userId, (tx) =>
    tx.query.offeringMeeting.findMany({
      where: inArray(offeringMeeting.offeringId, offeringIds),
      orderBy: (m, { asc }) => [asc(m.dayOfWeek), asc(m.startTime)],
    }),
  );
  for (const m of meetings) {
    const list = meetingsByOffering.get(m.offeringId) ?? [];
    list.push(m);
    meetingsByOffering.set(m.offeringId, list);
  }
  return meetingsByOffering;
}

/** Only the offerings a caller already has specific ids for (e.g. a plan's items) -- avoids pulling every offering in the semester when a handful is all that's needed. */
export async function getOfferingsByIds(actor: Actor, offeringIds: string[]) {
  if (offeringIds.length === 0) return [];
  return asUser(actor.userId, (tx) => tx.query.courseOffering.findMany({ where: inArray(courseOffering.id, offeringIds) }));
}

