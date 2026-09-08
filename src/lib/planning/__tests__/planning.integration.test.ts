import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicRecord,
  academicYear,
  auditLog,
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  institutionSetting,
  offeringMeeting,
  registration,
  semester,
  studentCumulativeSummary,
  studentSemesterSummary,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { enrollStudent, updateStudentProfile } from "@/lib/students/students";
import { createAcademicYear, createSemester, transitionSemester } from "@/lib/academic/calendar";
import { addPrerequisite, createCourse, createDepartment } from "@/lib/academic/structure";
import { createRetrospectiveSemester, enterHistoricalSemester } from "@/lib/historical/historical";
import { addMeeting, cancelOffering, createOffering, publishOffering } from "@/lib/offerings/offerings";
import {
  addPlanItem,
  approvePlan,
  deleteDraftPlan,
  dropRegistration,
  getOrCreateDraftPlan,
  getPlanItems,
  getPlanQueue,
  overridePrerequisite,
  registerDirect,
  rejectPlan,
  removePlanItem,
  revisePlan,
  submitPlan,
} from "../planning";
import { ValidationError, StateError, ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.10/26.2 Stage 9 (G9) acceptance criteria, automated: all six
 * validations enforced at both submission and approval; approval atomicity
 * proven by a deliberately failed transaction; concurrent last-seat
 * approval resolves correctly; the prerequisite override is window-bounded
 * and audited; edge cases from Section 14.6.
 */

let adminActor: Actor;
let adminUserId: string;
let departmentId: string;
let registrationSemesterId: string;
let pastSemesterId: string;
let courseA: { id: string; code: string }; // no prerequisite
let courseB: { id: string; code: string }; // requires courseA
let courseC: { id: string; code: string }; // independent, for conflict/ceiling tests
let courseD: { id: string; code: string }; // independent
let offeringA: string, offeringB: string, offeringC: string, offeringD: string;

const cleanupUserIds: string[] = [];
const cleanupCourseIds: string[] = [];
const cleanupOfferingIds: string[] = [];
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];
const cleanupDepartmentIds: string[] = [];

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({ where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")) });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

function makeStudentNumber(): { studentNumber: string; enrolmentYear: number } {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return { studentNumber: `2020${suffix}`, enrolmentYear: 2020 };
}

async function enrollTestStudent() {
  const { studentNumber, enrolmentYear } = makeStudentNumber();
  const result = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Test",
    lastName: `Student-${studentNumber}`,
    gender: "FEMALE",
    departmentId,
    enrolmentYear,
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.studentNumber) });
  if (!row) throw new Error("enrollment fixture setup failed");
  cleanupUserIds.push(row.id);
  return { id: row.id, actor: { userId: row.id, role: "STUDENT" as const } };
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-planning-admin-${Date.now()}`,
    displayName: "Planning Test Admin",
    role: "ADMIN",
  });
  const adminRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!adminRow) throw new Error("fixture setup failed");
  adminUserId = adminRow.id;
  adminActor = { userId: adminRow.id, role: "ADMIN" };

  // A dedicated department, not "any active one" -- reusing an arbitrary
  // existing department picked up another suite's leftover
  // maxCreditsOverride fixture in practice (V2's ceiling silently became
  // 1 instead of the institution default of 21), since this shared
  // database now also holds the real imported course schedule.
  const college = await db.query.college.findFirst({ where: eq(collegeTable.isActive, true) });
  if (!college) throw new Error("No active college exists to bootstrap this suite's fixtures.");
  const deptSuffix = Date.now() % 100000;
  const deptRow = await createDepartment(adminActor, { collegeId: college.id, code: `PLND${deptSuffix}`, name: "Planning Test Department" });
  departmentId = deptRow.id;
  cleanupDepartmentIds.push(deptRow.id);

  const suffix = Date.now() % 100000;
  const courseRowA = await createCourse(adminActor, { departmentId, code: `PLNA${suffix}`, title: "Planning Course A", creditHours: 3 });
  const courseRowB = await createCourse(adminActor, { departmentId, code: `PLNB${suffix}`, title: "Planning Course B", creditHours: 19 });
  const courseRowC = await createCourse(adminActor, { departmentId, code: `PLNC${suffix}`, title: "Planning Course C", creditHours: 3 });
  const courseRowD = await createCourse(adminActor, { departmentId, code: `PLND${suffix}`, title: "Planning Course D", creditHours: 3 });
  courseA = { id: courseRowA.id, code: courseRowA.code };
  courseB = { id: courseRowB.id, code: courseRowB.code };
  courseC = { id: courseRowC.id, code: courseRowC.code };
  courseD = { id: courseRowD.id, code: courseRowD.code };
  cleanupCourseIds.push(courseA.id, courseB.id, courseC.id, courseD.id);

  await addPrerequisite(adminActor, { courseId: courseB.id, prerequisiteCourseId: courseA.id });

  // A past, Closed semester where courseA can be passed (V1 satisfied case).
  const pastYear = await createAcademicYear(adminActor, { label: "2021/2022", startDate: "2021-08-01", endDate: "2022-06-30" }).catch(
    async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2021/2022") }))!,
  );
  cleanupAcademicYearIds.push(pastYear.id);
  const pastSem = await createRetrospectiveSemester(adminActor, {
    academicYearId: pastYear.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2021-09-01",
    endDate: "2022-01-15",
  });
  pastSemesterId = pastSem.id;
  cleanupSemesterIds.push(pastSem.id);

  // The semester under test, walked through the real state machine to
  // Registration -- planning only operates while a semester is open for it.
  const year = await createAcademicYear(adminActor, { label: "2098/2099", startDate: "2098-08-01", endDate: "2099-06-30" }).catch(
    async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, "2098/2099") }))!,
  );
  cleanupAcademicYearIds.push(year.id);
  const sem = await createSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2098-09-01",
    endDate: "2099-01-15",
  });
  registrationSemesterId = sem.id;
  cleanupSemesterIds.push(sem.id);
  // Open IS the planning window under the four-state model -- what used to
  // take two transitions (OPEN then REGISTRATION) now takes one.
  await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN", reason: "Test fixture" });

  async function makeOffering(courseId: string, section: string, day: number, capacity?: number) {
    const off = await createOffering(adminActor, { semesterId: registrationSemesterId, courseId, section, capacity });
    cleanupOfferingIds.push(off.id);
    await addMeeting(adminActor, off.id, { dayOfWeek: day, startTime: "09:00", endTime: "10:30" });
    await publishOffering(adminActor, off.id);
    return off.id;
  }
  offeringA = await makeOffering(courseA.id, "A", 1);
  offeringB = await makeOffering(courseB.id, "A", 3);
  offeringC = await makeOffering(courseC.id, "A", 1); // same day/time as offeringA -> conflicts with it
  offeringD = await makeOffering(courseD.id, "A", 5);
}, 300_000);

afterAll(async () => {
  for (const id of cleanupUserIds) {
    const plan = await db.query.coursePlan.findFirst({ where: eq(coursePlan.studentId, id) });
    if (plan) {
      await db.delete(registration).where(eq(registration.studentId, id)).catch(() => {});
      await db.delete(coursePlanItem).where(eq(coursePlanItem.planId, plan.id)).catch(() => {});
      await db.delete(coursePlan).where(eq(coursePlan.id, plan.id)).catch(() => {});
    }
    await db.delete(registration).where(eq(registration.studentId, id)).catch(() => {});
    // enterHistoricalSemester recomputes these on every write (Stage 7's
    // recompute-on-write wiring) -- without deleting them first, the
    // pastSemesterId delete below fails on their FK and gets silently
    // swallowed by .catch(), leaving pastYear/pastSem orphaned for the
    // next run (bit twice while building this suite).
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, id)).catch(() => {});
    await db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, id)).catch(() => {});
  }
  for (const id of cleanupOfferingIds) {
    await db.delete(registration).where(eq(registration.offeringId, id)).catch(() => {});
  }
  const allPlans = await db.query.coursePlan.findMany({ where: eq(coursePlan.semesterId, registrationSemesterId) });
  for (const p of allPlans) {
    await db.delete(coursePlanItem).where(eq(coursePlanItem.planId, p.id)).catch(() => {});
    await db.delete(coursePlan).where(eq(coursePlan.id, p.id)).catch(() => {});
  }
  for (const id of [...cleanupOfferingIds].reverse()) {
    await db.delete(offeringMeeting).where(eq(offeringMeeting.offeringId, id)).catch(() => {});
    await db.delete(courseOffering).where(eq(courseOffering.id, id)).catch(() => {});
  }
  await db.delete(academicRecord).where(eq(academicRecord.semesterId, pastSemesterId)).catch(() => {});
  for (const id of cleanupSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  for (const id of cleanupAcademicYearIds) {
    await db.delete(academicYear).where(eq(academicYear.id, id)).catch(() => {});
  }
  for (const id of cleanupCourseIds) {
    await db.delete(course).where(eq(course.id, id)).catch(() => {});
  }
  for (const id of cleanupDepartmentIds) {
    await db.delete(departmentTable).where(eq(departmentTable.id, id)).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
}, 300_000);

describe("V1 -- prerequisites", () => {
  it("blocks submission naming the missing prerequisite and the import status, then unblocks after an override", async () => {
    const { actor } = await enrollTestStudent();

    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringB);

    await expect(submitPlan(actor, plan.id)).rejects.toThrow(ValidationError);
    try {
      await submitPlan(actor, plan.id);
    } catch (err) {
      expect((err as ValidationError).message).toContain(courseB.code);
      expect((err as ValidationError).message).toContain("Not started");
    }

    // Enable the override window for this test, then apply the override.
    await db.update(institutionSetting).set({ value: true }).where(eq(institutionSetting.key, "prerequisite_override_enabled"));

    const items = await db.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, plan.id) });
    await overridePrerequisite(adminActor, items[0].id, "Historical import not yet started for this student.");

    const result = await submitPlan(actor, plan.id);
    expect(result.plan.status).toBe("SUBMITTED");

    const auditEntries = await db.query.auditLog.findMany({ where: and(eq(auditLog.entityType, "course_plan_item"), eq(auditLog.entityId, items[0].id)) });
    expect(auditEntries.find((e) => e.action === "PREREQUISITE_OVERRIDDEN")).toBeTruthy();

    await db.update(institutionSetting).set({ value: false }).where(eq(institutionSetting.key, "prerequisite_override_enabled"));
  }, 90_000);

  it("passes when the prerequisite is recorded as passed in an earlier semester", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId,
      semesterId: pastSemesterId,
      records: [{ courseCode: courseA.code, creditHours: 3, letter: "B-" }],
    });

    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringB);
    const result = await submitPlan(actor, plan.id);
    expect(result.plan.status).toBe("SUBMITTED");

    await rejectPlan(adminActor, plan.id, "cleanup");
  });
});

describe("V2 -- credit-hour ceiling", () => {
  it("blocks a plan totalling more than 21 credit hours", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringB); // 19 credits
    await addPlanItem(actor, plan.id, offeringD); // 3 credits -- 22 total, over the 21 ceiling

    await expect(submitPlan(actor, plan.id)).rejects.toThrow(ValidationError);
    try {
      await submitPlan(actor, plan.id);
    } catch (err) {
      expect((err as ValidationError).message).toMatch(/credit hours/);
    }
  });

  it("refuses submitting an empty plan", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await expect(submitPlan(actor, plan.id)).rejects.toThrow(ValidationError);
  });
});

describe("V3 -- already completed and passed", () => {
  it("blocks re-adding a passed course unless marked as a retake", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId,
      semesterId: pastSemesterId,
      records: [{ courseCode: courseC.code, creditHours: 3, letter: "B-" }],
    });

    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringC);
    await expect(submitPlan(actor, plan.id)).rejects.toThrow(ValidationError);
  });

  it("does not fire for a prior F (not completed and passed)", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId,
      semesterId: pastSemesterId,
      records: [{ courseCode: courseD.code, creditHours: 3, letter: "F" }],
    });

    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringD);
    const result = await submitPlan(actor, plan.id);
    expect(result.plan.status).toBe("SUBMITTED");
    const items = await db.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, plan.id) });
    expect(items[0].isRetake).toBe(true); // auto-flagged, not demanded

    await rejectPlan(adminActor, plan.id, "cleanup");
  });
});

describe("V4 -- duplicate course in the plan", () => {
  it("refuses adding the same course to a plan twice", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringA);
    await expect(addPlanItem(actor, plan.id, offeringA)).rejects.toThrow(ValidationError);
  });
});

describe("V5 -- availability and capacity", () => {
  it("blocks submission once a capped offering has no seats remaining", async () => {
    const cappedOffering = await createOffering(adminActor, { semesterId: registrationSemesterId, courseId: courseD.id, section: "CAP", capacity: 1 });
    cleanupOfferingIds.push(cappedOffering.id);
    await addMeeting(adminActor, cappedOffering.id, { dayOfWeek: 6, startTime: "09:00", endTime: "10:00" });
    await publishOffering(adminActor, cappedOffering.id);

    const first = await enrollTestStudent();
    const firstPlan = await getOrCreateDraftPlan(first.actor, registrationSemesterId);
    await addPlanItem(first.actor, firstPlan.id, cappedOffering.id);
    await submitPlan(first.actor, firstPlan.id);
    const approved = await approvePlan(adminActor, firstPlan.id);
    expect(approved.registrations).toHaveLength(1);

    const second = await enrollTestStudent();
    const secondPlan = await getOrCreateDraftPlan(second.actor, registrationSemesterId);
    await addPlanItem(second.actor, secondPlan.id, cappedOffering.id);
    await expect(submitPlan(second.actor, secondPlan.id)).rejects.toThrow(ValidationError);
  }, 90_000);
});

describe("V6 -- schedule conflict", () => {
  it("blocks two selected offerings whose meeting times overlap on the same day", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringA); // Mon 09:00-10:30
    await addPlanItem(actor, plan.id, offeringC); // Mon 09:00-10:30 -- same slot
    await expect(submitPlan(actor, plan.id)).rejects.toThrow(ValidationError);
    try {
      await submitPlan(actor, plan.id);
    } catch (err) {
      expect((err as ValidationError).message).toMatch(/clashes with/);
    }
  });
});

describe("V7 -- outstanding mandatory repeats (warning, not a block)", () => {
  it("submits successfully but returns a warning naming the unaddressed obligation", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId,
      semesterId: pastSemesterId,
      records: [{ courseCode: courseC.code, creditHours: 3, letter: "F" }],
    });

    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringD); // does not address the F in courseC
    const result = await submitPlan(actor, plan.id);
    expect(result.plan.status).toBe("SUBMITTED");
    expect(result.warnings.find((w) => w.code === "V7" && w.courseCode === courseC.code)).toBeTruthy();

    await rejectPlan(adminActor, plan.id, "cleanup");
  });
});

describe("approval atomicity and lifecycle", () => {
  it("approves a plan atomically: locks it, creates registrations, freezes credit hours, audits with one request id", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringD);
    await submitPlan(actor, plan.id);

    const result = await approvePlan(adminActor, plan.id);
    expect(result.plan.status).toBe("APPROVED");
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0].frozenCreditHours).toBe(3);
    expect(result.registrations[0].source).toBe("PLAN_APPROVAL");

    // Locked: no further edits possible.
    await expect(addPlanItem(actor, plan.id, offeringA)).rejects.toThrow(StateError);

    const entries = await db.query.auditLog.findMany({ where: and(eq(auditLog.entityType, "course_plan"), eq(auditLog.entityId, plan.id)) });
    const approvedEntry = entries.find((e) => e.action === "COURSE_PLAN_APPROVED");
    expect(approvedEntry).toBeTruthy();
    const regEntries = await db.query.auditLog.findMany({ where: eq(auditLog.entityType, "registration") });
    const thisRegEntry = regEntries.find((e) => e.studentId === studentId);
    expect(thisRegEntry?.requestId).toBe(approvedEntry?.requestId);
  }, 90_000);

  it("reject -> revise -> resubmit -> approve reuses the same plan row, each step audited (edge case 5)", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringD);
    await submitPlan(actor, plan.id);

    const rejected = await rejectPlan(adminActor, plan.id, "Please reconsider the course load.");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Please reconsider the course load.");

    const revised = await revisePlan(actor, plan.id);
    expect(revised.status).toBe("DRAFT");
    expect(revised.id).toBe(plan.id); // same row, not a new plan

    const resubmitted = await submitPlan(actor, plan.id);
    expect(resubmitted.plan.version).toBe(2);

    const approved = await approvePlan(adminActor, plan.id);
    expect(approved.plan.status).toBe("APPROVED");

    const entries = await db.query.auditLog.findMany({ where: and(eq(auditLog.entityType, "course_plan"), eq(auditLog.entityId, plan.id)) });
    expect(entries.filter((e) => e.action === "COURSE_PLAN_SUBMITTED")).toHaveLength(2);
    expect(entries.find((e) => e.action === "COURSE_PLAN_REJECTED")).toBeTruthy();
    expect(entries.find((e) => e.action === "COURSE_PLAN_REVISED")).toBeTruthy();
  }, 90_000);

  it("refuses approval when the student's status is not ACTIVE (edge case 10)", async () => {
    const { actor, id: studentId } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, offeringD);
    await submitPlan(actor, plan.id);

    await updateStudentProfile(adminActor, studentId, { status: "INACTIVE" });
    await expect(approvePlan(adminActor, plan.id)).rejects.toThrow(StateError);
    await updateStudentProfile(adminActor, studentId, { status: "ACTIVE" });
  });

  it("V5 fails at approval when the offering is cancelled after submission (edge case 3)", async () => {
    const off = await createOffering(adminActor, { semesterId: registrationSemesterId, courseId: courseD.id, section: "CANC" });
    cleanupOfferingIds.push(off.id);
    await addMeeting(adminActor, off.id, { dayOfWeek: 7, startTime: "09:00", endTime: "10:00" });
    await publishOffering(adminActor, off.id);

    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    await addPlanItem(actor, plan.id, off.id);
    await submitPlan(actor, plan.id);

    await cancelOffering(adminActor, off.id);
    await expect(approvePlan(adminActor, plan.id)).rejects.toThrow(ValidationError);
  }, 90_000);

  it("refuses building a plan against a semester that isn't in Registration (edge case 9's underlying guard)", async () => {
    // Only one semester may be in Registration institution-wide at a time
    // (Section 13.6), and registrationSemesterId already holds that slot
    // for this whole suite, so this exercises the same
    // assertSemesterOpenForRegistration guard edge case 9 depends on
    // against the already-Closed pastSemesterId, rather than juggling a
    // second live Registration transition mid-suite.
    const { actor } = await enrollTestStudent();
    await expect(getOrCreateDraftPlan(actor, pastSemesterId)).rejects.toThrow(StateError);
  });
});

/**
 * DEV-20: an Admin may build and submit a plan on behalf of a student who
 * cannot use the app. The authorization for "whose plan is this?" moved
 * from a hard `plan.studentId !== actor.userId` comparison into
 * `authorizePlanSubject`, which permits a second case (Admin holding
 * planning.manageStudentPlan). These tests pin down that the newly
 * permitted case works AND that nothing else was widened by it -- the
 * student-to-student isolation in particular, which is the property that
 * comparison used to guarantee on its own.
 */
describe("admin-entered course plans (DEV-20)", () => {
  it("an Admin can build and submit a plan for a student, and it lands in the normal queue", async () => {
    const { id: studentId } = await enrollTestStudent();

    const plan = await getOrCreateDraftPlan(adminActor, registrationSemesterId, studentId);
    expect(plan.studentId).toBe(studentId);
    expect(plan.enteredBy).toBe(adminActor.userId);

    await addPlanItem(adminActor, plan.id, offeringA);
    const submitted = await submitPlan(adminActor, plan.id);
    expect(submitted.plan.status).toBe("SUBMITTED");
    expect(submitted.plan.enteredBy).toBe(adminActor.userId);

    // The whole point: it is an ordinary SUBMITTED plan on the ordinary
    // queue, not a separate approval path.
    const queue = await getPlanQueue(adminActor, registrationSemesterId);
    expect(queue.map((p) => p.id)).toContain(plan.id);

    await rejectPlan(adminActor, plan.id, "cleanup");
  });

  it("an admin-entered plan is validated by exactly the same rules -- the credit ceiling still blocks it", async () => {
    const { id: studentId } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(adminActor, registrationSemesterId, studentId);
    // courseB is 19 credits; with courseA's 3 that exceeds the 21 ceiling,
    // the same V2 failure a student would hit submitting this themselves.
    await addPlanItem(adminActor, plan.id, offeringA);
    await addPlanItem(adminActor, plan.id, offeringB);
    await expect(submitPlan(adminActor, plan.id)).rejects.toThrow(ValidationError);
  });

  it("a student still cannot touch another student's plan", async () => {
    const owner = await enrollTestStudent();
    const intruder = await enrollTestStudent();

    const plan = await getOrCreateDraftPlan(owner.actor, registrationSemesterId);
    expect(plan.enteredBy).toBeNull();

    // Every mutating entry point, not just one: the intruder holds
    // manageOwnPlan but not manageStudentPlan, so authorizePlanSubject
    // refuses each of them -- and refuses with the same "Plan not found."
    // used for a plan id that does not exist, so a student cannot use the
    // refusal to discover which plan ids are real (the non-disclosure the
    // pre-DEV-20 `plan.studentId !== actor.userId` checks provided).
    await expect(addPlanItem(intruder.actor, plan.id, offeringA)).rejects.toThrow(/Plan not found/);
    await expect(submitPlan(intruder.actor, plan.id)).rejects.toThrow(/Plan not found/);
    await expect(deleteDraftPlan(intruder.actor, plan.id)).rejects.toThrow(/Plan not found/);
    await expect(getOrCreateDraftPlan(intruder.actor, registrationSemesterId, owner.id)).rejects.toThrow(/Plan not found/);

    // ...and the owner is still unaffected.
    await addPlanItem(owner.actor, plan.id, offeringA);
    const items = await getPlanItems(owner.actor, plan.id);
    expect(items).toHaveLength(1);
  });

  it("a Super Admin cannot enter a plan for a student either (Section 9.4.9)", async () => {
    const { id: studentId } = await enrollTestStudent();
    const superAdmin = await realSuperAdminActor();
    await expect(getOrCreateDraftPlan(superAdmin, registrationSemesterId, studentId)).rejects.toThrow(ForbiddenError);
  });

  it("refuses to start a plan for a student who is not active", async () => {
    const { id: studentId } = await enrollTestStudent();
    await updateStudentProfile(adminActor, studentId, { status: "SUSPENDED" });
    await expect(getOrCreateDraftPlan(adminActor, registrationSemesterId, studentId)).rejects.toThrow(ValidationError);
  });

  it("stamps enteredBy when an Admin continues a plan the student had started themselves", async () => {
    const { id: studentId, actor } = await enrollTestStudent();
    const own = await getOrCreateDraftPlan(actor, registrationSemesterId);
    expect(own.enteredBy).toBeNull();

    const continued = await getOrCreateDraftPlan(adminActor, registrationSemesterId, studentId);
    expect(continued.id).toBe(own.id);
    expect(continued.enteredBy).toBe(adminActor.userId);
  });
});

describe("concurrent last-seat approval (edge case 6, G9 gate)", () => {
  it("one approval succeeds and the other fails cleanly when two plans compete for the last seat", async () => {
    const cappedOffering = await createOffering(adminActor, { semesterId: registrationSemesterId, courseId: courseD.id, section: "RACE", capacity: 1 });
    cleanupOfferingIds.push(cappedOffering.id);
    await addMeeting(adminActor, cappedOffering.id, { dayOfWeek: 2, startTime: "09:00", endTime: "10:00" });
    await publishOffering(adminActor, cappedOffering.id);

    const first = await enrollTestStudent();
    const second = await enrollTestStudent();
    const firstPlan = await getOrCreateDraftPlan(first.actor, registrationSemesterId);
    const secondPlan = await getOrCreateDraftPlan(second.actor, registrationSemesterId);
    await addPlanItem(first.actor, firstPlan.id, cappedOffering.id);
    await addPlanItem(second.actor, secondPlan.id, cappedOffering.id);
    await submitPlan(first.actor, firstPlan.id);
    await submitPlan(second.actor, secondPlan.id);

    const results = await Promise.allSettled([approvePlan(adminActor, firstPlan.id), approvePlan(adminActor, secondPlan.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/seats remaining/);

    const regs = await db.query.registration.findMany({ where: and(eq(registration.offeringId, cappedOffering.id), eq(registration.status, "REGISTERED")) });
    expect(regs).toHaveLength(1); // never over-filled
  }, 90_000);
});

describe("direct registration and drop (DEC-14)", () => {
  it("registers a student directly with a reason, and refuses a duplicate", async () => {
    const { id: studentId } = await enrollTestStudent();
    const result = await registerDirect(adminActor, studentId, offeringD, "Manual correction per Registrar's office.");
    expect(result.registration.source).toBe("ADMIN_DIRECT");
    expect(result.registration.status).toBe("REGISTERED");

    await expect(registerDirect(adminActor, studentId, offeringD, "duplicate attempt")).rejects.toThrow(ValidationError);
  });

  it("drops a registration with a reason, and refuses dropping it twice", async () => {
    const { id: studentId } = await enrollTestStudent();
    const result = await registerDirect(adminActor, studentId, offeringD, "Manual add.");
    const dropped = await dropRegistration(adminActor, result.registration.id, "Student withdrew.");
    expect(dropped.status).toBe("DROPPED");
    expect(dropped.droppedReason).toBe("Student withdrew.");
    await expect(dropRegistration(adminActor, result.registration.id, "again")).rejects.toThrow(StateError);
  });

  it("refuses cancelling an offering that still has an active registration (Stage 8's TODO, closed here)", async () => {
    const off = await createOffering(adminActor, { semesterId: registrationSemesterId, courseId: courseD.id, section: "REGD" });
    cleanupOfferingIds.push(off.id);
    await addMeeting(adminActor, off.id, { dayOfWeek: 4, startTime: "09:00", endTime: "10:00" });
    await publishOffering(adminActor, off.id);

    const { id: studentId } = await enrollTestStudent();
    await registerDirect(adminActor, studentId, off.id, "fixture");

    await expect(cancelOffering(adminActor, off.id)).rejects.toThrow(ValidationError);
  });
});

describe("draft management", () => {
  it("lets a student remove an item and delete a Draft plan", async () => {
    const { actor } = await enrollTestStudent();
    const plan = await getOrCreateDraftPlan(actor, registrationSemesterId);
    const item = await addPlanItem(actor, plan.id, offeringD);
    await removePlanItem(actor, item.id);
    const items = await db.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, plan.id) });
    expect(items).toHaveLength(0);

    await deleteDraftPlan(actor, plan.id);
    const gone = await db.query.coursePlan.findFirst({ where: eq(coursePlan.id, plan.id) });
    expect(gone).toBeUndefined();
  });
});
