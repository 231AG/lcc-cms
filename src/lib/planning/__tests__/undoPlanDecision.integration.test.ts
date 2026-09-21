import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
  approvePlanItem,
  getOrCreateDraftPlan,
  rejectPlanItem,
  submitPlan,
  undoPlanDecision,
  undoPlanItemDecision,
} from "../planning";
import { getControlSheet } from "../controlSheet";
import { StateError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Taking back a decision that was made in error.
 *
 * Approval used to be a one-way door: a mis-click left an Admin with no
 * way back, because an APPROVED plan refuses editing and there was no
 * un-approve. What matters here is not that the status flips -- it is what
 * happens to the registrations underneath it, and what the undo refuses to
 * do.
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
let studentSeq = Math.floor(Math.random() * 8000);
async function newStudent(): Promise<Actor> {
  const userId = id();
  const studentNumber = `2026${String(++studentSeq).padStart(4, "0")}`;
  await db.insert(appUser).values({
    id: userId, loginIdentifier: studentNumber, displayName: "Undo Fixture",
    role: "STUDENT", status: "ACTIVE", mustChangePassword: false,
  });
  await db.insert(studentTable).values({
    id: userId, studentNumber, firstName: "Undo", lastName: "Fixture", departmentId,
    enrolmentYear: 2026, status: "ACTIVE", historicalImportStatus: "COMPLETE", createdBy: superAdminId,
  });
  return actorOf(userId, "STUDENT");
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

describe("undoing a review decision", () => {
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

  it("puts an approved plan back under review with every course pending again", async () => {
    const { planId } = await approvedPlan();

    await undoPlanDecision(admin(), planId, "Approved the wrong student.");

    expect((await planOf(planId))!.status).toBe("SUBMITTED");
    const items = await itemsOf(planId);
    expect(items.map((i) => i.status)).toEqual(["PENDING", "PENDING"]);
    // A stale decision left on a pending item shows up in the queue as a
    // live objection nobody made.
    expect(items.every((i) => i.decidedBy === null && i.decidedAt === null && i.rejectionReason === null)).toBe(true);
  });

  it("drops the registrations the approval created, rather than leaving the student enrolled", async () => {
    const { planId } = await approvedPlan();
    expect((await registrationsOf(planId)).filter((r) => r.status === "REGISTERED")).toHaveLength(2);

    await undoPlanDecision(admin(), planId, "Wrong semester.");

    const regs = await registrationsOf(planId);
    expect(regs.every((r) => r.status === "DROPPED")).toBe(true);
    // Dropped, not deleted: the history of what was registered survives.
    expect(regs).toHaveLength(2);
    expect(regs.every((r) => (r.droppedReason ?? "").includes("Wrong semester."))).toBe(true);
  });

  it("can be decided again afterwards, which is the whole point", async () => {
    const { planId } = await approvedPlan();
    await undoPlanDecision(admin(), planId, "Mis-clicked.");

    // Re-approving has to reinstate the dropped rows rather than insert new
    // ones: registration_unique_student_offering_idx has no partial WHERE,
    // so it covers DROPPED rows too.
    await approvePlan(admin(), planId);

    expect((await planOf(planId))!.status).toBe("APPROVED");
    const live = (await registrationsOf(planId)).filter((r) => r.status === "REGISTERED");
    expect(live).toHaveLength(2);
  });

  it("works on a partly approved plan, and on a rejected one", async () => {
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await addPlanItem(student, plan.id, offeringBId);
    await submitPlan(student, plan.id);
    const [first, second] = await itemsOf(plan.id);
    await rejectPlanItem(admin(), first.id, "Clashes with your other class.");
    await approvePlanItem(admin(), second.id);
    expect((await planOf(plan.id))!.status).toBe("PARTIALLY_APPROVED");

    await undoPlanDecision(admin(), plan.id, "Refused the wrong course.");

    expect((await planOf(plan.id))!.status).toBe("SUBMITTED");
    expect((await itemsOf(plan.id)).map((i) => i.status)).toEqual(["PENDING", "PENDING"]);
  });

  it("refuses a plan that has no decision on it yet", async () => {
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await submitPlan(student, plan.id);

    await expect(undoPlanDecision(admin(), plan.id, "Nothing to undo.")).rejects.toThrow(StateError);
  });

  it("requires a reason -- an unexplained reversal is the thing an auditor asks about", async () => {
    const { planId } = await approvedPlan();
    await expect(undoPlanDecision(admin(), planId, "   ")).rejects.toThrow(ValidationError);
    // And it did not half-do it.
    expect((await planOf(planId))!.status).toBe("APPROVED");
  });

  it("will not let a Super Admin undo a decision", async () => {
    // Section 9.4.9: a Super Admin has no role in course planning at all,
    // and an undo is a planning decision like any other.
    const { planId } = await approvedPlan();
    await expect(
      undoPlanDecision(actorOf(superAdminId, "SUPER_ADMIN"), planId, "Back door."),
    ).rejects.toThrow(/Not available to your role/i);
  });

  it("will not let a student undo the decision on their own plan", async () => {
    const { student, planId } = await approvedPlan();
    await expect(undoPlanDecision(student, planId, "I changed my mind.")).rejects.toThrow(
      /Not available to your role/i,
    );
  });

  // ---- per-course undo -------------------------------------------------

  /** Two courses submitted; the first approved, the second left alone. The
   *  plan is still SUBMITTED, because it only rolls up once every course
   *  has a decision -- which is exactly the state the whole-plan undo
   *  cannot reach. */
  async function oneApprovedOnePending() {
    const student = await newStudent();
    const plan = await getOrCreateDraftPlan(student, semesterId);
    await addPlanItem(student, plan.id, offeringAId);
    await addPlanItem(student, plan.id, offeringBId);
    await submitPlan(student, plan.id);
    const [first, second] = await itemsOf(plan.id);
    await approvePlanItem(admin(), first.id);
    return { student, planId: plan.id, approvedId: first.id, pendingId: second.id };
  }

  it("reaches the case the whole-plan undo cannot: a decided course on a still-submitted plan", async () => {
    const { planId, approvedId } = await oneApprovedOnePending();
    // The gap this exists to close, stated as an assertion rather than a
    // comment: the plan-level undo refuses here.
    expect((await planOf(planId))!.status).toBe("SUBMITTED");
    await expect(undoPlanDecision(admin(), planId, "x")).rejects.toThrow(StateError);

    await undoPlanItemDecision(admin(), approvedId, "Approved the wrong row.");

    const items = await itemsOf(planId);
    expect(items.find((i) => i.id === approvedId)!.status).toBe("PENDING");
  });

  it("leaves every other course on the plan exactly as it was", async () => {
    const { planId, approvedId, pendingId } = await oneApprovedOnePending();
    await undoPlanItemDecision(admin(), approvedId, "Wrong row.");
    const items = await itemsOf(planId);
    // The one still awaiting a decision is untouched, and so is its lack
    // of one -- undoing one row is not a reason to disturb another.
    expect(items.find((i) => i.id === pendingId)!.status).toBe("PENDING");
    expect(items.find((i) => i.id === pendingId)!.decidedBy).toBeNull();
  });

  it("drops only that course's registration", async () => {
    const { planId, approvedId } = await oneApprovedOnePending();
    expect((await registrationsOf(planId)).filter((r) => r.status === "REGISTERED")).toHaveLength(1);

    await undoPlanItemDecision(admin(), approvedId, "Wrong row.");

    const regs = await registrationsOf(planId);
    expect(regs.filter((r) => r.status === "REGISTERED")).toHaveLength(0);
    expect(regs.filter((r) => r.status === "DROPPED")).toHaveLength(1);
  });

  it("lets the course be approved again, reinstating its registration", async () => {
    const { planId, approvedId } = await oneApprovedOnePending();
    await undoPlanItemDecision(admin(), approvedId, "Wrong row.");
    await approvePlanItem(admin(), approvedId);
    expect((await registrationsOf(planId)).filter((r) => r.status === "REGISTERED")).toHaveLength(1);
  });

  it("takes a fully decided plan back to submitted when one of its courses is undone", async () => {
    const { planId } = await approvedPlan();
    expect((await planOf(planId))!.status).toBe("APPROVED");
    const [first] = await itemsOf(planId);

    await undoPlanItemDecision(admin(), first.id, "One of these was wrong.");

    // There is something left to decide again, which is what SUBMITTED
    // means -- and the other course keeps its approval.
    const plan = await planOf(planId);
    expect(plan!.status).toBe("SUBMITTED");
    expect(plan!.reviewedBy).toBeNull();
    const items = await itemsOf(planId);
    expect(items.filter((i) => i.status === "APPROVED")).toHaveLength(1);
    expect(items.filter((i) => i.status === "PENDING")).toHaveLength(1);
  });

  it("refuses a course that has not been decided, and an unexplained undo", async () => {
    const { pendingId, approvedId } = await oneApprovedOnePending();
    await expect(undoPlanItemDecision(admin(), pendingId, "Nothing to undo.")).rejects.toThrow(StateError);
    await expect(undoPlanItemDecision(admin(), approvedId, "  ")).rejects.toThrow(ValidationError);
  });

  it("will not let a Super Admin or the student undo one course", async () => {
    const { student, approvedId } = await oneApprovedOnePending();
    await expect(
      undoPlanItemDecision(actorOf(superAdminId, "SUPER_ADMIN"), approvedId, "Back door."),
    ).rejects.toThrow(/Not available to your role/i);
    await expect(undoPlanItemDecision(student, approvedId, "Mine.")).rejects.toThrow(
      /Not available to your role/i,
    );
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
    expect(sheet.studentNumber).toMatch(/^2026/);
  });

  it("will not print a Control Sheet for a role that cannot review plans", async () => {
    const { student, planId } = await approvedPlan();
    await expect(getControlSheet(student, planId)).rejects.toThrow(/Not available to your role/i);
    await expect(getControlSheet(actorOf(superAdminId, "SUPER_ADMIN"), planId)).rejects.toThrow(
      /Not available to your role/i,
    );
  });

  it("leaves a registration a Registrar already dropped by hand alone", async () => {
    const { planId } = await approvedPlan();
    const [firstReg] = await registrationsOf(planId);
    await db
      .update(registration)
      .set({ status: "DROPPED", droppedReason: "Student withdrew from this class." })
      .where(eq(registration.id, firstReg.id));

    await undoPlanDecision(admin(), planId, "Re-reviewing.");

    const after = await db.query.registration.findFirst({ where: eq(registration.id, firstReg.id) });
    // Undoing a review decision is not a reason to rewrite something a
    // Registrar deliberately did for their own reasons.
    expect(after!.droppedReason).toBe("Student withdrew from this class.");
  });
});
