import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicYear,
  auditLog,
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  offeringMeeting,
  registration,
  semester,
  student,
} from "@/lib/db/schema";
import {
  addPlanItem,
  approvePlan,
  getMyPlan,
  getMyPlans,
  getOrCreateDraftPlan,
  getPlanItems,
  getPlanValidation,
  getPlansForStudent,
  overrideScheduleConflict,
  submitPlan,
} from "../planning";

/**
 * V6 (timetable clash) after the override change.
 *
 * The rule has two halves that are easy to get backwards, so both are
 * pinned here: submitting is NEVER stopped by a clash, and approving is
 * ALWAYS stopped by one until somebody accepts it.
 *
 * Rows are inserted directly rather than through enrollStudent, so this
 * needs a database but not Supabase -- which is what lets it run in CI
 * alongside the permission-kernel tests.
 */

const tag = Math.random().toString(36).slice(2, 7);
const uid = () => crypto.randomUUID();

const superId = uid();
const adminId = uid();
const studentId = uid();
// A second student, because there is exactly one plan per student per
// semester and the first one's plan ends the run approved.
const student2Id = uid();
const collegeId = uid();
const deptId = uid();
const yearId = uid();
const semId = uid();
const courseAId = uid();
const courseBId = uid();
const offeringAId = uid();
const offeringBId = uid();

const adminActor = { userId: adminId, role: "ADMIN" as const };
const studentActor = { userId: studentId, role: "STUDENT" as const };

beforeAll(async () => {
  const studentNumber = `2026${Math.floor(1000 + Math.random() * 8999)}`;
  const student2Number = `2026${Math.floor(1000 + Math.random() * 8999)}`;

  await db.insert(appUser).values([
    { id: superId, loginIdentifier: `sc-sup-${tag}`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false, createdBy: superId },
    { id: adminId, loginIdentifier: `sc-adm-${tag}`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false, createdBy: superId },
    { id: studentId, loginIdentifier: studentNumber, displayName: "Stu Dent", role: "STUDENT", status: "ACTIVE", mustChangePassword: false, createdBy: adminId },
    { id: student2Id, loginIdentifier: student2Number, displayName: "Two Dent", role: "STUDENT", status: "ACTIVE", mustChangePassword: false, createdBy: adminId },
  ]);
  await db.insert(collegeTable).values({ id: collegeId, code: `SC${tag}`, name: "Conflict College", isActive: true });
  await db.insert(departmentTable).values({ id: deptId, collegeId, code: `SD${tag}`, name: "Conflict Dept", isActive: true });
  await db.insert(student).values([
    {
      id: studentId, studentNumber, firstName: "Stu", lastName: "Dent", gender: "FEMALE",
      departmentId: deptId, enrolmentYear: 2026, createdBy: adminId,
    },
    {
      id: student2Id, studentNumber: student2Number, firstName: "Two", lastName: "Dent", gender: "MALE",
      departmentId: deptId, enrolmentYear: 2026, createdBy: adminId,
    },
  ]);
  await db.insert(academicYear).values({ id: yearId, label: `SC${tag}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
  await db.insert(semester).values({
    id: semId, academicYearId: yearId, sequence: 1, name: "Semester I",
    state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15",
  });

  // Two courses that meet at exactly the same time on the same day.
  for (const [courseId, code, offeringId] of [
    [courseAId, `AAA${tag}`, offeringAId],
    [courseBId, `BBB${tag}`, offeringBId],
  ] as const) {
    await db.insert(course).values({ id: courseId, departmentId: deptId, code, title: "Clashing Course", creditHours: 3, isActive: true });
    await db.insert(courseOffering).values({
      id: offeringId, semesterId: semId, courseId, section: "1",
      instructorName: "Staff", capacity: 30, status: "PUBLISHED", frozenCreditHours: 3,
    });
    await db.insert(offeringMeeting).values({
      id: uid(), offeringId, dayOfWeek: 1, startTime: "09:00", endTime: "10:30", room: "PAPE 1",
    });
  }
});

afterAll(async () => {
  const offeringIds = [offeringAId, offeringBId];
  const planIds = (await db.select({ id: coursePlan.id }).from(coursePlan).where(inArray(coursePlan.studentId, [studentId, student2Id]))).map((p) => p.id);
  if (planIds.length) {
    await db.delete(registration).where(inArray(registration.planItemId, (await db.select({ id: coursePlanItem.id }).from(coursePlanItem).where(inArray(coursePlanItem.planId, planIds))).map((i) => i.id)));
    await db.delete(registration).where(inArray(registration.studentId, [studentId, student2Id]));
    await db.delete(coursePlanItem).where(inArray(coursePlanItem.planId, planIds));
    await db.delete(coursePlan).where(inArray(coursePlan.id, planIds));
  }
  await db.delete(auditLog).where(inArray(auditLog.actorUserId, [adminId, studentId]));
  await db.delete(offeringMeeting).where(inArray(offeringMeeting.offeringId, offeringIds));
  await db.delete(courseOffering).where(inArray(courseOffering.id, offeringIds));
  await db.delete(course).where(inArray(course.id, [courseAId, courseBId]));
  await db.delete(semester).where(inArray(semester.id, [semId]));
  await db.delete(academicYear).where(inArray(academicYear.id, [yearId]));
  await db.delete(student).where(inArray(student.id, [studentId, student2Id]));
  await db.delete(departmentTable).where(inArray(departmentTable.id, [deptId]));
  await db.delete(collegeTable).where(inArray(collegeTable.id, [collegeId]));
  // superId is deliberately left behind: a trigger refuses to let the last
  // active Super Admin be deleted, and this fixture's is the only one in a
  // freshly seeded database. Each run makes its own, and CI starts clean.
  await db.delete(appUser).where(inArray(appUser.id, [studentId, student2Id, adminId]));
});

describe("V6 timetable clash", () => {
  it("does not stop a student submitting a plan that clashes", async () => {
    const plan = await getOrCreateDraftPlan(studentActor, semId);
    await addPlanItem(studentActor, plan.id, offeringAId);
    await addPlanItem(studentActor, plan.id, offeringBId);

    const result = await submitPlan(studentActor, plan.id);

    expect(result.plan.status).toBe("SUBMITTED");
    // The clash travels with the plan rather than being swallowed.
    expect(result.warnings.some((w) => w.code === "V6")).toBe(true);
  });

  it("stops approval, and says so on the review screen, until it is accepted", async () => {
    const plan = await getOrCreateDraftPlan(studentActor, semId);

    const before = await getPlanValidation(adminActor, plan.id);
    expect(before.blocking.some((i) => i.code === "V6")).toBe(true);

    await expect(approvePlan(adminActor, plan.id)).rejects.toThrow(/clashes with/);
  });

  it("clears the whole pair when either side is overridden, and still warns", async () => {
    const plan = await getOrCreateDraftPlan(studentActor, semId);
    const items = await getPlanItems(adminActor, plan.id);

    await overrideScheduleConflict(adminActor, items[0].id, "Student attends the first half only.");

    const after = await getPlanValidation(adminActor, plan.id);
    expect(after.blocking.some((i) => i.code === "V6")).toBe(false);
    // Accepted is not the same as gone: the plan still reports the overlap.
    expect(after.warnings.some((i) => i.code === "V6")).toBe(true);

    const approved = await approvePlan(adminActor, plan.id);
    expect(approved.plan.status).toBe("APPROVED");
  });

  it("refuses an override with no reason", async () => {
    const plan = await getOrCreateDraftPlan(studentActor, semId);
    const items = await getPlanItems(adminActor, plan.id);
    await expect(overrideScheduleConflict(adminActor, items[0].id, "   ")).rejects.toThrow(/reason is required/i);
  });
});

describe("a plan entered by an Admin", () => {
  it("accepts its own clash without anybody pressing override", async () => {
    // Entered on the student's behalf, so `enteredBy` is set. A different
    // student from the tests above, whose plan is already approved.
    const plan = await getOrCreateDraftPlan(adminActor, semId, student2Id);
    await addPlanItem(adminActor, plan.id, offeringAId);
    await addPlanItem(adminActor, plan.id, offeringBId);

    const validation = await getPlanValidation(adminActor, plan.id);

    expect(validation.blocking.some((i) => i.code === "V6")).toBe(false);
    expect(validation.warnings.some((i) => i.code === "V6")).toBe(true);
  });
});


/**
 * A student's own planning screen must only call reads a student is
 * actually allowed to make. The page once used getPlansForStudent -- the
 * ADMIN read -- to build its semester picker, which threw for every
 * student who opened it and took the whole route down with a 500.
 */
describe("the reads a student's own planning page makes", () => {
  it("lets a student list their own plans", async () => {
    await getOrCreateDraftPlan(studentActor, semId);

    const plans = await getMyPlans(studentActor);

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((p) => p.studentId === studentId)).toBe(true);
  });

  it("lets a student read their own plan for a semester, and its items", async () => {
    const plan = await getMyPlan(studentActor, semId);
    expect(plan).toBeTruthy();
    await expect(getPlanItems(studentActor, plan!.id)).resolves.toBeInstanceOf(Array);
  });

  it("refuses the Admin read to a student -- which is why getMyPlans exists", async () => {
    await expect(getPlansForStudent(studentActor, studentId)).rejects.toThrow(/planning.reviewPlan/);
  });

  it("still gives an Admin every plan for a student", async () => {
    const plans = await getPlansForStudent(adminActor, studentId);
    expect(plans.length).toBeGreaterThan(0);
  });
});
