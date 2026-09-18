import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicYear,
  college as collegeTable,
  course,
  courseOffering,
  department as departmentTable,
  offeringMeeting,
  semester,
} from "@/lib/db/schema";
import { addMeeting, cancelOffering, publishOffering, reinstateOffering, rescheduleMeetings } from "../offerings";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The two dead ends an Admin hit on a real offering.
 *
 * 1. Cancelling was one-way. Publish only ever showed for a DRAFT, so once
 *    an offering was CANCELLED there was no control that could move it, and
 *    the class had to be recreated under a different section number.
 * 2. There was no way to CHANGE a meeting time -- only add one and remove
 *    one. Adding without removing leaves the offering on the timetable
 *    twice, which reads as the system having duplicated it.
 */

const id = () => randomUUID();
const ADMIN = id(), SUPER = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id(), COURSE = id(), OFFERING = id();

const admin = { userId: ADMIN, role: "ADMIN", displayName: "a", mustChangePassword: false } as Actor;

describe("an offering's lifecycle", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "S", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "A", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `LC-${COLLEGE.slice(0, 6)}`, name: "Lifecycle College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: "CECS", name: "Christian Education", isActive: true });
    await db.insert(academicYear).values({ id: YEAR, label: `LIFE-${YEAR.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" });
    await db.insert(course).values({ id: COURSE, departmentId: DEPT, code: `CECS${COURSE.slice(0, 3)}`, title: "Christian Service", creditHours: 1, isActive: true });
    await db.insert(courseOffering).values({
      id: OFFERING, courseId: COURSE, semesterId: SEM, section: "1", capacity: 30, status: "DRAFT", frozenCreditHours: 1,
    });
  });

  afterAll(async () => {
    await db.delete(offeringMeeting).where(eq(offeringMeeting.offeringId, OFFERING));
    await db.delete(courseOffering).where(inArray(courseOffering.id, [OFFERING]));
    await db.delete(course).where(inArray(course.id, [COURSE]));
    await db.delete(semester).where(inArray(semester.id, [SEM]));
    await db.delete(academicYear).where(inArray(academicYear.id, [YEAR]));
    await db.delete(departmentTable).where(inArray(departmentTable.id, [DEPT]));
    await db.delete(collegeTable).where(inArray(collegeTable.id, [COLLEGE]));
    // ADMIN and SUPER are left behind: every action above writes an audit
    // row that references its actor, and audit_log is exactly the thing that
    // must not be deletable to tidy a test up.
  });

  const statusOf = async () =>
    (await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, OFFERING) }))!.status;
  const slots = async () => db.query.offeringMeeting.findMany({ where: eq(offeringMeeting.offeringId, OFFERING) });

  it("a cancelled offering can be brought back, and published again", async () => {
    await addMeeting(admin, OFFERING, { dayOfWeek: 5, startTime: "19:00", endTime: "20:00", room: "OVR 1" });
    await publishOffering(admin, OFFERING);
    expect(await statusOf()).toBe("PUBLISHED");

    await cancelOffering(admin, OFFERING);
    expect(await statusOf()).toBe("CANCELLED");

    // Used to be the end of the road.
    await reinstateOffering(admin, OFFERING);
    expect(await statusOf()).toBe("DRAFT");

    // And the schedule survived the round trip, so it can go straight back out.
    expect(await slots()).toHaveLength(1);
    await publishOffering(admin, OFFERING);
    expect(await statusOf()).toBe("PUBLISHED");
  });

  it("refuses to reinstate anything that is not cancelled", async () => {
    await expect(reinstateOffering(admin, OFFERING)).rejects.toThrow(/cancelled/i);
  });

  it("changing a meeting time moves it rather than adding a second one", async () => {
    const before = await slots();
    expect(before).toHaveLength(1);

    await rescheduleMeetings(admin, before.map((m) => m.id), { startTime: "15:00", endTime: "16:00", room: "OVR 2" });

    const after = await slots();
    expect(after, "still one slot, not two").toHaveLength(1);
    expect(after[0].startTime).toBe("15:00:00");
    expect(after[0].endTime).toBe("16:00:00");
    expect(after[0].room).toBe("OVR 2");
    expect(after[0].dayOfWeek, "the day is untouched").toBe(5);
  });

  it("moves every day of a slot together", async () => {
    // A slot the table shows as one "MW" row is two meeting rows behind it.
    await addMeeting(admin, OFFERING, { dayOfWeek: 1, startTime: "08:00", endTime: "09:00", room: "PAPE 1" });
    await addMeeting(admin, OFFERING, { dayOfWeek: 3, startTime: "08:00", endTime: "09:00", room: "PAPE 1" });
    const slot = (await slots()).filter((m) => m.startTime === "08:00:00");
    expect(slot).toHaveLength(2);

    await rescheduleMeetings(admin, slot.map((m) => m.id), { startTime: "10:00", endTime: "11:00", room: "PAPE 2" });

    const moved = (await slots()).filter((m) => m.room === "PAPE 2");
    expect(moved).toHaveLength(2);
    expect(moved.map((m) => m.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it("refuses a move onto another of the offering's own slots", async () => {
    // Monday/Wednesday are at 10:00-11:00 in PAPE 2 after the move above.
    // Put a third slot on Monday afternoon, then try to move THAT onto the
    // morning pair -- same day, overlapping time, so it must be refused.
    await addMeeting(admin, OFFERING, { dayOfWeek: 1, startTime: "13:00", endTime: "14:00", room: "PAPE 3" });
    const afternoon = (await slots()).filter((m) => m.room === "PAPE 3");
    expect(afternoon).toHaveLength(1);

    await expect(
      rescheduleMeetings(admin, afternoon.map((m) => m.id), { startTime: "10:30", endTime: "11:30", room: "PAPE 3" }),
    ).rejects.toThrow(/overlaps/i);

    // And it stayed where it was rather than half-moving.
    const after = (await slots()).filter((m) => m.room === "PAPE 3");
    expect(after[0].startTime).toBe("13:00:00");
  });
});
