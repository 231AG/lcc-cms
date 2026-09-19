import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicYear,
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  registration,
  semester,
  student as studentTable,
} from "@/lib/db/schema";
import {
  addPlanItem,
  approvePlan,
  deleteDraftPlan,
  getOrCreateDraftPlan,
  rejectPlanItem,
  removePlanItem,
  revisePlan,
  submitPlan,
} from "../planning";
import { StateError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 14.2's "editable until submitted, then again if rejected", from
 * the student's side. The cases here were written against a bug found by
 * reproduction rather than reading: Revise followed by Submit used to leave
 * every item REJECTED, producing a SUBMITTED plan the Registrar could
 * neither approve nor reject and the student could no longer touch.
 *
 * Deliberately free of Supabase: every actor is a plain row and every
 * assertion reads through the raw connection, so this runs anywhere the
 * migrations have been applied.
 */

const id = () => randomUUID();
const superAdminId = id();
const adminId = id();
const collegeId = id();
const departmentId = id();
const yearId = id();
const semesterId = id();
const courseAId = id();
const courseBId = id();
const offeringAId = id();
const offeringBId = id();

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "Fixture", mustChangePassword: false }) as Actor;
const admin = () => actorOf(adminId, "ADMIN");

/** A fresh student per case -- these plans end in states that cannot be
 * cleaned up by deleting them, so sharing one student across cases would
 * make each depend on the last. The student number is the one fixture
 * value with a uniqueness index on it, and audit_log's foreign key means
 * these rows outlive the run, so the run picks its own block of numbers
 * rather than starting from a fixed one. */
let studentSeq = Math.floor(Math.random() * 8000);
async function newStudent(): Promise<Actor> {
  const userId = id();
  // student_number CHECK: ^(19|20)[0-9]{2}[0-9]{2,4}$
  const studentNumber = `2026${String(++studentSeq).padStart(4, "0")}`;
  await db.insert(appUser).values({
    id: userId,
    loginIdentifier: studentNumber,
    displayName: "Plan Fixture",
    role: "STUDENT",
    status: "ACTIVE",
    mustChangePassword: false,
  });
  await db.insert(studentTable).values({
    id: userId,
    studentNumber,
    firstName: "Plan",
    lastName: "Fixture",
    departmentId,
    enrolmentYear: 2026,
    status: "ACTIVE",
    historicalImportStatus: "COMPLETE",
    createdBy: superAdminId,
  });
  return actorOf(userId, "STUDENT");
}

const itemsOf = (planId: string) => db.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
const planOf = (planId: string) => db.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });

/** Two courses planned, submitted, and both turned down individually. */
async function planWithBothRejected() {
  const student = await newStudent();
  const plan = await getOrCreateDraftPlan(student, semesterId);
  await addPlanItem(student, plan.id, offeringAId);
  await addPlanItem(student, plan.id, offeringBId);
  await submitPlan(student, plan.id);
  for (const item of await itemsOf(plan.id)) {
    await rejectPlanItem(admin(), item.id, "Not offered to your year this semester.");
  }
  return { student, planId: plan.id };
}

/** Two courses planned and submitted; the first turned down, the second
 * approved and registered by "Approve all". */
async function planPartlyApproved() {
  const student = await newStudent();
  const plan = await getOrCreateDraftPlan(student, semesterId);
  await addPlanItem(student, plan.id, offeringAId);
  await addPlanItem(student, plan.id, offeringBId);
  await submitPlan(student, plan.id);
  const [first] = await itemsOf(plan.id);
  await rejectPlanItem(admin(), first.id, "Clashes with your other class.");
  await approvePlan(admin(), plan.id);
  return { student, planId: plan.id, rejectedItemId: first.id };
}

describe("revising a plan the Registrar turned down", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: superAdminId, loginIdentifier: `sa-${superAdminId}@lcc.edu`, displayName: "Fixture Super Admin", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: adminId, loginIdentifier: `ad-${adminId}@lcc.edu`, displayName: "Fixture Registrar", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: collegeId, code: `RV-${collegeId.slice(0, 6)}`, name: "Revision College", isActive: true });
    await db.insert(departmentTable).values({ id: departmentId, collegeId, code: `RV${departmentId.slice(0, 2)}`, name: "Revision Dept", isActive: true });
    await db.insert(academicYear).values({ id: yearId, label: `RV-${yearId.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: semesterId, academicYearId: yearId, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" });
    await db.insert(course).values([
      { id: courseAId, departmentId, code: `RV${courseAId.slice(0, 3)}101`, title: "Revision One", creditHours: 3, isActive: true },
      { id: courseBId, departmentId, code: `RV${courseBId.slice(0, 3)}102`, title: "Revision Two", creditHours: 3, isActive: true },
    ]);
    await db.insert(courseOffering).values([
      { id: offeringAId, courseId: courseAId, semesterId, section: "A", capacity: 30, status: "PUBLISHED", frozenCreditHours: 3 },
      { id: offeringBId, courseId: courseBId, semesterId, section: "A", capacity: 30, status: "PUBLISHED", frozenCreditHours: 3 },
    ]);
  });

  it("rolls the plan up to REJECTED when every course is turned down", async () => {
    const { planId } = await planWithBothRejected();
    expect((await planOf(planId))!.status).toBe("REJECTED");
  });

  it("puts the turned-down courses back to PENDING on resubmit, so the Registrar can decide them again", async () => {
    const { student, planId } = await planWithBothRejected();

    await revisePlan(student, planId);
    await submitPlan(student, planId);

    const items = await itemsOf(planId);
    expect(items.map((i) => i.status)).toEqual(["PENDING", "PENDING"]);
    // The decision is cleared with the status -- a stale reason on a pending
    // item would show up in the Registrar's queue as a live objection.
    expect(items.every((i) => i.rejectionReason === null && i.decidedBy === null && i.decidedAt === null)).toBe(true);
    expect((await planOf(planId))!.status).toBe("SUBMITTED");

    // The point of all of it: the plan is decidable again.
    await approvePlan(admin(), planId);
    expect((await planOf(planId))!.status).toBe("APPROVED");
  });

  it("lets the student swap a turned-down course for a different one", async () => {
    const { student, planId } = await planWithBothRejected();

    await revisePlan(student, planId);
    for (const item of await itemsOf(planId)) await removePlanItem(student, item.id);
    await addPlanItem(student, planId, offeringAId);
    await submitPlan(student, planId);

    const items = await itemsOf(planId);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("PENDING");
    await approvePlan(admin(), planId);
    expect((await planOf(planId))!.status).toBe("APPROVED");
  });

  it("reopens a partly-approved plan, keeping the approved course registered", async () => {
    const { student, planId, rejectedItemId } = await planPartlyApproved();
    expect((await planOf(planId))!.status).toBe("PARTIALLY_APPROVED");

    await revisePlan(student, planId);
    expect((await planOf(planId))!.status).toBe("DRAFT");

    await removePlanItem(student, rejectedItemId);
    await submitPlan(student, planId);

    const items = await itemsOf(planId);
    expect(items.map((i) => i.status)).toEqual(["APPROVED"]);
    // Submitting with the refused course gone leaves nothing to decide, so
    // the plan settles straight back to APPROVED rather than parking in the
    // queue -- and the registration it already had is still there.
    expect((await planOf(planId))!.status).toBe("APPROVED");
    const regs = await db.query.registration.findMany({
      where: and(eq(registration.studentId, student.userId), eq(registration.semesterId, semesterId)),
    });
    expect(regs).toHaveLength(1);
    expect(regs[0].offeringId).toBe(offeringBId);
  });

  it("refuses to remove a course that is already registered", async () => {
    const { student, planId } = await planPartlyApproved();
    await revisePlan(student, planId);
    const approved = (await itemsOf(planId)).find((i) => i.status === "APPROVED")!;
    await expect(removePlanItem(student, approved.id)).rejects.toThrow(StateError);
  });

  it("refuses to delete a reopened plan that still holds a registration", async () => {
    const { student, planId } = await planPartlyApproved();
    await revisePlan(student, planId);
    await expect(deleteDraftPlan(student, planId)).rejects.toThrow(StateError);
  });

  it("puts a resubmitted replacement back in the Registrar's queue", async () => {
    const { student, planId, rejectedItemId } = await planPartlyApproved();
    await revisePlan(student, planId);
    await removePlanItem(student, rejectedItemId);
    await addPlanItem(student, planId, offeringAId); // a different section of the refused slot
    await submitPlan(student, planId);

    expect((await planOf(planId))!.status).toBe("SUBMITTED");
    const statuses = (await itemsOf(planId)).map((i) => i.status).sort();
    expect(statuses).toEqual(["APPROVED", "PENDING"]);

    // "Approve all" decides the new course and leaves the registered one be.
    await approvePlan(admin(), planId);
    expect((await planOf(planId))!.status).toBe("APPROVED");
    const regs = await db.query.registration.findMany({
      where: and(eq(registration.studentId, student.userId), eq(registration.semesterId, semesterId)),
    });
    expect(regs).toHaveLength(2);
  });

  it("does not count a seat the student already holds against them", async () => {
    // Fill the class to capacity with the student's own registration, then
    // make them resubmit the plan that registration came from.
    const soleSeat = id();
    const soleCourse = id();
    await db.insert(course).values({ id: soleCourse, departmentId, code: `RV${soleCourse.slice(0, 3)}103`, title: "One Seat", creditHours: 3, isActive: true });
    await db.insert(courseOffering).values({ id: soleSeat, courseId: soleCourse, semesterId, section: "A", capacity: 1, status: "PUBLISHED", frozenCreditHours: 3 });

    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, soleSeat);
    await addPlanItem(student, plan.id, offeringAId);
    await submitPlan(student, plan.id);
    const items = await itemsOf(plan.id);
    const toReject = items.find((i) => i.offeringId === offeringAId)!;
    await rejectPlanItem(admin(), toReject.id, "Take it next semester.");
    await approvePlan(admin(), plan.id); // registers the one-seat course

    await revisePlan(student, plan.id);
    // The one-seat class is now full -- of this student. Resubmitting must
    // not tell them their own seat is taken.
    await expect(submitPlan(student, plan.id)).resolves.toBeTruthy();
  });
});
