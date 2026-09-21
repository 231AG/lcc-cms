import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
  registration,
  semester,
  student as studentTable,
} from "@/lib/db/schema";
import {
  addPlanItem,
  approvePlan,
  approvePlanItem,
  getOrCreateDraftPlan,
  registerDirect,
  rejectPlanItem,
  submitPlan,
  deletePlan,
} from "../planning";
import { getControlSheet } from "../controlSheet";
import { ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Throwing a plan away, from the review screen.
 *
 * The College's answer to "a decision was made in error". What matters
 * here is not that the plan row disappears -- it is what goes with it,
 * what does NOT go with it, and what the delete refuses to do at all.
 * Once this has run the audit log is the only remaining record, so the
 * entry it writes is part of the behaviour, not a side effect.
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

// A fresh student per case: these plans end in states that cannot be
// cleaned up by deleting them, so sharing one would make each case depend
// on the last.
//
// The student number is the one fixture value with a uniqueness index on
// it, and audit_log's foreign key means these rows outlive the run -- so
// on a database that has been used before, a fixed block of numbers
// eventually collides. (It did.) The number is drawn from the whole space
// the CHECK allows, `^(19|20)[0-9]{2}[0-9]{2,4}$`, and a collision is
// retried rather than failing the test it happened to land in.
async function newStudent(): Promise<Actor> {
  for (let attempt = 0; ; attempt++) {
    const userId = id();
    const studentNumber = `20${String(Math.floor(Math.random() * 100)).padStart(2, "0")}${String(
      Math.floor(Math.random() * 10000),
    ).padStart(4, "0")}`;
    try {
      await db.insert(appUser).values({
        id: userId, loginIdentifier: studentNumber, displayName: "Plan Fixture",
        role: "STUDENT", status: "ACTIVE", mustChangePassword: false,
      });
      await db.insert(studentTable).values({
        id: userId, studentNumber, firstName: "Plan", lastName: "Fixture", departmentId,
        enrolmentYear: 2026, status: "ACTIVE", historicalImportStatus: "COMPLETE", createdBy: superAdminId,
      });
      return actorOf(userId, "STUDENT");
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      if (code !== "23505" || attempt >= 20) throw err;
    }
  }
}

const itemsOf = (planId: string) => db.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
const planOf = (planId: string) => db.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
const registrationsOf = async (planId: string) => {
  const ids = (await itemsOf(planId)).map((i) => i.id);
  return ids.length ? db.query.registration.findMany({ where: inArray(registration.planItemId, ids) }) : [];
};

/** Two courses, submitted, both approved -- so two live registrations. */
async function approvedPlan() {
  const student = await newStudent();
  const plan = await getOrCreateDraftPlan(student, semesterId);
  await addPlanItem(student, plan.id, offeringAId);
  await addPlanItem(student, plan.id, offeringBId);
  await submitPlan(student, plan.id);
  await approvePlan(admin(), plan.id);
  return { student, planId: plan.id };
}

describe("deleting a plan", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: superAdminId, loginIdentifier: `sa-${superAdminId}@lcc.edu`, displayName: "Fixture Super Admin", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: adminId, loginIdentifier: `ad-${adminId}@lcc.edu`, displayName: "Fixture Registrar", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: collegeId, code: `UN-${collegeId.slice(0, 6)}`, name: "Undo College", isActive: true });
    await db.insert(departmentTable).values({ id: departmentId, collegeId, code: `UN${departmentId.slice(0, 2)}`, name: "Undo Dept", isActive: true });
    await db.insert(academicYear).values({ id: yearId, label: `UN-${yearId.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: semesterId, academicYearId: yearId, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" });
    await db.insert(course).values([
      { id: courseAId, departmentId, code: `UN${courseAId.slice(0, 3)}101`, title: "Undo One", creditHours: 3, isActive: true },
      { id: courseBId, departmentId, code: `UN${courseBId.slice(0, 3)}102`, title: "Undo Two", creditHours: 3, isActive: true },
    ]);
    await db.insert(courseOffering).values([
      { id: offeringAId, courseId: courseAId, semesterId, section: "1", capacity: 30, status: "PUBLISHED", frozenCreditHours: 3 },
      { id: offeringBId, courseId: courseBId, semesterId, section: "1", capacity: 30, status: "PUBLISHED", frozenCreditHours: 3 },
    ]);
  });

  it("removes the plan, its courses and the registrations they created", async () => {
    const { planId } = await approvedPlan();
    expect((await registrationsOf(planId)).filter((r) => r.status === "REGISTERED")).toHaveLength(2);
    const itemIds = (await itemsOf(planId)).map((i) => i.id);

    const summary = await deletePlan(admin(), planId, "Entered against the wrong student.");

    expect(summary.coursesDeleted).toBe(2);
    expect(summary.registrationsDeleted).toBe(2);
    expect(await planOf(planId)).toBeUndefined();
    expect(await itemsOf(planId)).toHaveLength(0);
    const leftover = await db.query.registration.findMany({ where: inArray(registration.planItemId, itemIds) });
    expect(leftover).toHaveLength(0);
  });

  it("works on a plan still under review, and on one with nothing decided", async () => {
    // Not restricted to a decided plan: an Admin deciding course by course
    // leaves the plan SUBMITTED the whole way, and that is exactly when a
    // mistake gets noticed.
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await submitPlan(student, plan.id);
    expect((await planOf(plan.id))!.status).toBe("SUBMITTED");

    await deletePlan(admin(), plan.id, "Duplicate of another plan.");
    expect(await planOf(plan.id)).toBeUndefined();
  });

  it("works on a partly approved plan", async () => {
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await addPlanItem(student, plan.id, offeringBId);
    await submitPlan(student, plan.id);
    const [first, second] = await itemsOf(plan.id);
    await rejectPlanItem(admin(), first.id, "Clashes with your other class.");
    await approvePlanItem(admin(), second.id);
    expect((await planOf(plan.id))!.status).toBe("PARTIALLY_APPROVED");

    const summary = await deletePlan(admin(), plan.id, "Start again.");
    expect(summary.previousStatus).toBe("PARTIALLY_APPROVED");
    expect(await planOf(plan.id)).toBeUndefined();
  });

  it("leaves a direct admin registration alone, because it did not come from this plan", async () => {
    // A seat the Registrar gave out by hand carries no plan item, so it is
    // not this plan's to take away. Deliberately a different student: the
    // point is that deleting one plan does not reach past its own rows.
    const other = await newStudent();
    const direct = await registerDirect(admin(), other.userId, offeringAId, "Special case.");
    const { planId } = await approvedPlan();

    await deletePlan(admin(), planId, "Gone.");

    const stillThere = await db.query.registration.findFirst({ where: eq(registration.id, direct.registration.id) });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.status).toBe("REGISTERED");
    expect(stillThere!.planItemId).toBeNull();
  });

  it("records what it destroyed before destroying it", async () => {
    const { planId } = await approvedPlan();
    await deletePlan(admin(), planId, "Wrong semester entirely.");

    const entry = (await db.query.auditLog.findMany({ where: eq(auditLog.entityId, planId) })).find(
      (e) => e.action === "COURSE_PLAN_DELETED",
    );
    // The plan row is gone, so this entry is the only place any of this
    // still exists. It has to carry the detail, not just the id.
    expect(entry).toBeTruthy();
    expect(entry!.reason).toBe("Wrong semester entirely.");
    const old = entry!.oldValue as { courses: string[]; status: string; registrationsDeleted: number };
    expect(old.courses).toHaveLength(2);
    expect(old.status).toBe("APPROVED");
    expect(old.registrationsDeleted).toBe(2);
  });

  it("refuses without a reason, and deletes nothing", async () => {
    const { planId } = await approvedPlan();
    await expect(deletePlan(admin(), planId, "   ")).rejects.toThrow(ValidationError);
    expect(await planOf(planId)).toBeTruthy();
  });

  it("refuses a plan that does not exist", async () => {
    await expect(deletePlan(admin(), id(), "Ghost.")).rejects.toThrow(ValidationError);
  });

  it("will not let a Super Admin delete a plan", async () => {
    // Section 9.4.9: a Super Admin has no role in course planning at all,
    // and deleting one is still course planning.
    const { planId } = await approvedPlan();
    await expect(deletePlan(actorOf(superAdminId, "SUPER_ADMIN"), planId, "Back door.")).rejects.toThrow(
      /Not available to your role/i,
    );
    expect(await planOf(planId)).toBeTruthy();
  });

  it("will not let a student delete their own plan", async () => {
    const { student, planId } = await approvedPlan();
    await expect(deletePlan(student, planId, "I changed my mind.")).rejects.toThrow(
      /Not available to your role/i,
    );
    expect(await planOf(planId)).toBeTruthy();
  });

  it("prints only the approved courses on the Control Sheet", async () => {
    // A course the Registrar refused is not something the student is
    // enrolled in; printing it beside the ones they are is how somebody
    // turns up to the wrong class.
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await addPlanItem(student, plan.id, offeringBId);
    await submitPlan(student, plan.id);
    const [first, second] = await itemsOf(plan.id);
    await rejectPlanItem(admin(), first.id, "Not offered to your year.");
    await approvePlanItem(admin(), second.id);

    const sheet = await getControlSheet(admin(), plan.id);

    expect(sheet.courses).toHaveLength(1);
    expect(sheet.courses[0].title).toBe("Undo Two");
    expect(sheet.totalCreditHours).toBe(3);
    expect(sheet.major).toBe("Undo Dept");
    expect(sheet.studentNumber).toMatch(/^20\d{6}$/);
  });

  it("will not print a Control Sheet for a role that cannot review plans", async () => {
    const { student, planId } = await approvedPlan();
    await expect(getControlSheet(student, planId)).rejects.toThrow(/Not available to your role/i);
    await expect(getControlSheet(actorOf(superAdminId, "SUPER_ADMIN"), planId)).rejects.toThrow(
      /Not available to your role/i,
    );
  });
});
