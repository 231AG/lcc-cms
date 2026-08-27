import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, academicYear, semester, course, department, courseOffering, offeringMeeting, auditLog } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { createAcademicYear, createSemester } from "@/lib/academic/calendar";
import { createCourse } from "@/lib/academic/structure";
import { createRetrospectiveSemester } from "@/lib/historical/historical";
import {
  addMeeting,
  cancelOffering,
  createOffering,
  getOfferingsForSemester,
  publishOffering,
  removeMeeting,
  updateOffering,
} from "../offerings";
import { ForbiddenError, StateError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.9 Stage 8 acceptance criteria, automated: duplicate section
 * refused; offering against a Closed semester refused; overlapping
 * meetings within one offering refused; publish/cancel lifecycle audited.
 */

let adminActor: Actor;
let adminUserId: string;
let departmentId: string;
let courseId: string;
let courseCode: string;
let openSemesterId: string;
const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };
const superAdminActor: Actor = { userId: "00000000-0000-0000-0000-000000000002", role: "SUPER_ADMIN" };

const cleanupOfferingIds: string[] = [];

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-offerings-admin-${Date.now()}`,
    displayName: "Offerings Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to bootstrap this suite's fixtures.");
  departmentId = dept.id;

  courseCode = `OFF${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, {
    departmentId,
    code: courseCode,
    title: "Offerings Test Course",
    creditHours: 3,
  });
  courseId = courseRow.id;

  const year = await createAcademicYear(adminActor, {
    label: "2099/2100",
    startDate: "2099-08-01",
    endDate: "2100-06-30",
  }).catch(async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2099/2100") }))!);

  const sem = await createSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2099-09-01",
    endDate: "2100-01-15",
  });
  openSemesterId = sem.id;
}, 60_000);

afterAll(async () => {
  for (const id of cleanupOfferingIds) {
    await db.delete(offeringMeeting).where(eq(offeringMeeting.offeringId, id)).catch(() => {});
    await db.delete(courseOffering).where(eq(courseOffering.id, id)).catch(() => {});
  }
  await db.delete(semester).where(eq(semester.id, openSemesterId)).catch(() => {});
  await db.delete(course).where(eq(course.id, courseId)).catch(() => {});
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
}, 60_000);

describe("createOffering", () => {
  it("creates a DRAFT offering with frozen credit hours, and audits", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "A" });
    cleanupOfferingIds.push(offering.id);

    expect(offering.status).toBe("DRAFT");
    expect(offering.frozenCreditHours).toBe(3);

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "course_offering"), eq(auditLog.entityId, offering.id)),
    });
    expect(entries.find((e) => e.action === "OFFERING_CREATED")).toBeTruthy();
  });

  it("refuses a duplicate section for the same course and semester", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "B" });
    cleanupOfferingIds.push(offering.id);

    await expect(
      createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "b" }), // case-insensitive match
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an offering against a Closed semester", async () => {
    const year = await createAcademicYear(adminActor, { label: "2018/2019", startDate: "2018-08-01", endDate: "2019-06-30" }).catch(
      async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2018/2019") }))!,
    );
    const closedSem = await createRetrospectiveSemester(adminActor, {
      academicYearId: year.id,
      sequence: 1,
      name: "First Semester",
      startDate: "2018-09-01",
      endDate: "2019-01-15",
    });

    await expect(
      createOffering(adminActor, { semesterId: closedSem.id, courseId, section: "A" }),
    ).rejects.toThrow(StateError);

    await db.delete(semester).where(eq(semester.id, closedSem.id));
  });

  it("refuses a Student and a Super Admin", async () => {
    await expect(
      createOffering(studentActor, { semesterId: openSemesterId, courseId, section: "C" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createOffering(superAdminActor, { semesterId: openSemesterId, courseId, section: "C" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("addMeeting / removeMeeting", () => {
  it("refuses an overlapping meeting within the same offering, but allows a non-overlapping one", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "D" });
    cleanupOfferingIds.push(offering.id);

    await addMeeting(adminActor, offering.id, { dayOfWeek: 1, startTime: "09:00", endTime: "10:30", room: "B4" });

    await expect(
      addMeeting(adminActor, offering.id, { dayOfWeek: 1, startTime: "10:00", endTime: "11:00" }),
    ).rejects.toThrow(ValidationError);

    const second = await addMeeting(adminActor, offering.id, { dayOfWeek: 3, startTime: "09:00", endTime: "10:30" });
    expect(second.dayOfWeek).toBe(3);

    await removeMeeting(adminActor, second.id);
  });

  it("refuses end time at or before start time", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "E" });
    cleanupOfferingIds.push(offering.id);

    await expect(
      addMeeting(adminActor, offering.id, { dayOfWeek: 1, startTime: "10:00", endTime: "09:00" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("publishOffering", () => {
  it("requires at least one meeting time before publishing", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "F" });
    cleanupOfferingIds.push(offering.id);

    await expect(publishOffering(adminActor, offering.id)).rejects.toThrow(ValidationError);

    await addMeeting(adminActor, offering.id, { dayOfWeek: 2, startTime: "09:00", endTime: "10:00" });
    const published = await publishOffering(adminActor, offering.id);
    expect(published.status).toBe("PUBLISHED");

    await expect(publishOffering(adminActor, offering.id)).rejects.toThrow(StateError);
  });

  it("a meeting added after publication is audited; one added before is not", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "G" });
    cleanupOfferingIds.push(offering.id);
    await addMeeting(adminActor, offering.id, { dayOfWeek: 2, startTime: "09:00", endTime: "10:00" });

    const preEntries = await db.query.auditLog.findMany({ where: eq(auditLog.entityType, "offering_meeting") });
    const preCount = preEntries.length;

    await publishOffering(adminActor, offering.id);
    const postMeeting = await addMeeting(adminActor, offering.id, { dayOfWeek: 4, startTime: "09:00", endTime: "10:00" });

    const postEntries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "offering_meeting"), eq(auditLog.entityId, postMeeting.id)),
    });
    expect(postEntries.find((e) => e.action === "OFFERING_MEETING_CHANGED")).toBeTruthy();
    expect(preEntries.length).toBe(preCount); // the pre-publication meeting stayed un-audited
  });
});

describe("updateOffering and cancelOffering", () => {
  it("updates instructor and capacity, and audits", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "H" });
    cleanupOfferingIds.push(offering.id);

    const updated = await updateOffering(adminActor, offering.id, { instructorName: "Dr. Kollie", capacity: 30 });
    expect(updated.instructorName).toBe("Dr. Kollie");
    expect(updated.capacity).toBe(30);

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "course_offering"), eq(auditLog.entityId, offering.id)),
    });
    expect(entries.find((e) => e.action === "OFFERING_UPDATED")).toBeTruthy();
  });

  it("cancels an offering and refuses cancelling it twice", async () => {
    const offering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "J" });
    cleanupOfferingIds.push(offering.id);

    const cancelled = await cancelOffering(adminActor, offering.id);
    expect(cancelled.status).toBe("CANCELLED");

    await expect(cancelOffering(adminActor, offering.id)).rejects.toThrow(StateError);
  });
});

describe("student visibility (Section 10.5)", () => {
  it("a student sees only PUBLISHED offerings; Admin sees everything", async () => {
    const draftOffering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "K" });
    cleanupOfferingIds.push(draftOffering.id);
    const publishedOffering = await createOffering(adminActor, { semesterId: openSemesterId, courseId, section: "L" });
    cleanupOfferingIds.push(publishedOffering.id);
    await addMeeting(adminActor, publishedOffering.id, { dayOfWeek: 5, startTime: "09:00", endTime: "10:00" });
    await publishOffering(adminActor, publishedOffering.id);

    const asAdmin = await getOfferingsForSemester(adminActor, openSemesterId);
    expect(asAdmin.some((o) => o.id === draftOffering.id)).toBe(true);
    expect(asAdmin.some((o) => o.id === publishedOffering.id)).toBe(true);

    const asStudent = await getOfferingsForSemester(studentActor, openSemesterId);
    expect(asStudent.some((o) => o.id === draftOffering.id)).toBe(false);
    expect(asStudent.some((o) => o.id === publishedOffering.id)).toBe(true);
  });
});
