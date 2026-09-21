import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  auditLog,
  academicYear,
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  offeringMeeting,
  registration,
  semester,
  student as studentTable,
} from "@/lib/db/schema";
import { deleteOffering } from "../offerings";
import { ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Removing an offering from the record.
 *
 * Before this there was no way to: an offering could be created,
 * published, cancelled and reinstated, and a cancelled one then sat on the
 * Course Offerings page with nothing that would shift it. The bin already
 * in that row deletes a TIMETABLE SLOT, so it appeared to work and the row
 * stayed -- which is the other half of why it looked stuck.
 *
 * What matters here is what it REFUSES. A delete that takes an enrolment
 * with it would be worse than the dead end it replaces.
 */

const id = () => randomUUID();
const ADMIN = id(), SUPER = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id();

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "t", mustChangePassword: false }) as Actor;
const admin = () => actorOf(ADMIN, "ADMIN");

/** A fresh course and offering per case: these get deleted, so sharing one
 *  would make every case depend on the order they ran in. */
let seq = 0;
async function newOffering(status: string, opts: { withMeeting?: boolean } = {}) {
  const courseId = id(), offeringId = id();
  seq += 1;
  await db.insert(course).values({
    id: courseId, departmentId: DEPT, code: `DEL${String(seq).padStart(3, "0")}${Math.floor(Math.random() * 900) + 100}`,
    title: "Deletable", creditHours: 3, isActive: true,
  });
  await db.insert(courseOffering).values({
    id: offeringId, courseId, semesterId: SEM, section: "1", capacity: 30, status, frozenCreditHours: 3,
  });
  if (opts.withMeeting) {
    await db.insert(offeringMeeting).values({ offeringId, dayOfWeek: 5, startTime: "12:00", endTime: "13:00", room: "Room 101" });
  }
  return { courseId, offeringId };
}

async function newStudent() {
  const userId = id();
  const studentNumber = `20${String(Math.floor(Math.random() * 100)).padStart(2, "0")}${String(
    Math.floor(Math.random() * 10000),
  ).padStart(4, "0")}`;
  await db.insert(appUser).values({
    id: userId, loginIdentifier: studentNumber, displayName: "S", role: "STUDENT", status: "ACTIVE", mustChangePassword: false,
  });
  await db.insert(studentTable).values({
    id: userId, studentNumber, firstName: "Del", lastName: "Fixture", departmentId: DEPT,
    enrolmentYear: 2026, status: "ACTIVE", historicalImportStatus: "COMPLETE", createdBy: SUPER,
  });
  return userId;
}

describe("deleting an offering", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "S", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "A", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `DL-${COLLEGE.slice(0, 6)}`, name: "Delete College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `DL${DEPT.slice(0, 2)}`, name: "Delete Dept", isActive: true });
    await db.insert(academicYear).values({ id: YEAR, label: `DEL-${YEAR.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" });
  });

  it("removes a cancelled offering, which is the case that had no way out", async () => {
    const { offeringId } = await newOffering("CANCELLED", { withMeeting: true });

    const summary = await deleteOffering(admin(), offeringId);

    expect(summary.meetingsDeleted).toBe(1);
    expect(await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) })).toBeUndefined();
    expect(await db.query.offeringMeeting.findMany({ where: eq(offeringMeeting.offeringId, offeringId) })).toHaveLength(0);
  });

  it("removes a published one too -- the rule is what points at it, not its badge", async () => {
    const { offeringId } = await newOffering("PUBLISHED", { withMeeting: true });
    await deleteOffering(admin(), offeringId);
    expect(await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) })).toBeUndefined();
  });

  it("leaves the course in the catalogue", async () => {
    // Deleting a class this semester is not deleting the course. Students
    // hold grades against that row.
    const { courseId, offeringId } = await newOffering("CANCELLED");
    await deleteOffering(admin(), offeringId);
    expect(await db.query.course.findFirst({ where: eq(course.id, courseId) })).toBeTruthy();
  });

  it("refuses while a student is registered", async () => {
    const { offeringId } = await newOffering("PUBLISHED");
    const studentId = await newStudent();
    await db.insert(registration).values({
      studentId, offeringId, semesterId: SEM, source: "ADMIN_DIRECT", status: "REGISTERED", frozenCreditHours: 3,
    });

    await expect(deleteOffering(admin(), offeringId)).rejects.toThrow(/registered for this offering/i);
    expect(await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) })).toBeTruthy();
  });

  it("refuses even for a registration already dropped, because that is still a record of who was enrolled", async () => {
    const { offeringId } = await newOffering("CANCELLED");
    const studentId = await newStudent();
    await db.insert(registration).values({
      studentId, offeringId, semesterId: SEM, source: "ADMIN_DIRECT", status: "DROPPED",
      droppedReason: "Withdrew", frozenCreditHours: 3,
    });

    await expect(deleteOffering(admin(), offeringId)).rejects.toThrow(/past registration/i);
  });

  it("refuses while a student's course plan lists it", async () => {
    const { courseId, offeringId } = await newOffering("PUBLISHED");
    const studentId = await newStudent();
    const planId = id();
    await db.insert(coursePlan).values({ id: planId, studentId, semesterId: SEM, status: "DRAFT" });
    await db.insert(coursePlanItem).values({ planId, offeringId, courseId, isRetake: false });

    await expect(deleteOffering(admin(), offeringId)).rejects.toThrow(/course plan/i);
  });

  it("refuses an offering that is not there", async () => {
    await expect(deleteOffering(admin(), id())).rejects.toThrow(ValidationError);
  });

  it("will not let a Super Admin delete one", async () => {
    // REQ-R04 denies a Super Admin offering.manage outright.
    const { offeringId } = await newOffering("CANCELLED");
    await expect(deleteOffering(actorOf(SUPER, "SUPER_ADMIN"), offeringId)).rejects.toThrow(
      /Not available to your role/i,
    );
    expect(await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) })).toBeTruthy();
  });

  it("records the timetable it destroyed, because afterwards there is no row to read", async () => {
    const { offeringId } = await newOffering("CANCELLED", { withMeeting: true });
    await deleteOffering(admin(), offeringId);

    const entry = (await db.query.auditLog.findMany({ where: eq(auditLog.entityId, offeringId) })).find(
      (e) => e.action === "OFFERING_DELETED",
    );
    expect(entry).toBeTruthy();
    const old = entry!.oldValue as { status: string; section: string; meetings: Array<{ day: number; room: string }> };
    expect(old.status).toBe("CANCELLED");
    expect(old.section).toBe("1");
    expect(old.meetings).toHaveLength(1);
    expect(old.meetings[0].day).toBe(5);
  });
});
