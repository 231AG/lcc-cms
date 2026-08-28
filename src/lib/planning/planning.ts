import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import {
  academicRecord,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  coursePrerequisite,
  department,
  institutionSetting,
  offeringMeeting,
  registration,
  semester,
  student,
} from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { StateError, ValidationError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getSetting<T>(tx: Tx, key: string): Promise<T | null> {
  const row = await tx.query.institutionSetting.findFirst({ where: eq(institutionSetting.key, key) });
  return (row?.value as T | undefined) ?? null;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Validation (Section 14.3/14.4) -- the SAME function is invoked at both
// enforcement points (submission and approval, REQ-P03). Reads whatever
// the plan currently holds; never mutates except for the V3 auto-retake
// carve-out for a mandatory-repeat obligation, which is a data correction
// applied to the item being validated, not a side effect of validating.
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  code: "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7";
  courseCode: string;
  message: string;
}

export interface ValidationResult {
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface PlanItemForValidation {
  id?: string; // absent for an item being validated before it's persisted
  offeringId: string;
  courseId: string;
  isRetake: boolean;
  prereqOverrideReason: string | null;
}

async function validatePlan(
  tx: Tx,
  studentId: string,
  semesterId: string,
  items: PlanItemForValidation[],
): Promise<ValidationResult> {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const studentRow = await tx.query.student.findFirst({ where: eq(student.id, studentId) });
  if (!studentRow) throw new ValidationError("Student not found.");

  const targetSemester = await tx.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!targetSemester) throw new ValidationError("Semester not found.");

  if (items.length === 0) {
    blocking.push({ code: "V2", courseCode: "", message: "Add at least one course before submitting." });
    return { blocking, warnings };
  }

  const offeringIds = [...new Set(items.map((i) => i.offeringId))];
  const offeringRows = await tx.query.courseOffering.findMany({ where: inArray(courseOffering.id, offeringIds) });
  const offeringById = new Map(offeringRows.map((o) => [o.id, o]));

  const courseIds = [...new Set(items.map((i) => i.courseId))];
  const courseRows = await tx.query.course.findMany({ where: inArray(course.id, courseIds) });
  const courseById = new Map(courseRows.map((c) => [c.id, c]));
  const courseLabel = (courseId: string) => courseById.get(courseId)?.code ?? "Unknown course";

  // V4 -- duplicate courses within the plan itself (the unique index gives
  // a raw constraint error; this gives a named one).
  const seenCourseIds = new Set<string>();
  for (const item of items) {
    if (seenCourseIds.has(item.courseId)) {
      blocking.push({ code: "V4", courseCode: courseLabel(item.courseId), message: `${courseLabel(item.courseId)} is selected more than once in this plan.` });
    }
    seenCourseIds.add(item.courseId);
  }

  // V2 -- credit-hour ceiling (REQ-P05/REQ-C12). Institution default 21,
  // a department may set the ceiling lower for its own students, never
  // higher (CR-04). No credit-limit override exists in Phase 1 (DEC-36).
  const institutionMax = (await getSetting<number>(tx, "max_credits_per_semester")) ?? 21;
  const studentDept = await tx.query.department.findFirst({ where: eq(department.id, studentRow.departmentId) });
  const effectiveMax = studentDept?.maxCreditsOverride != null ? Math.min(institutionMax, studentDept.maxCreditsOverride) : institutionMax;
  const totalCredits = items.reduce((sum, i) => sum + (offeringById.get(i.offeringId)?.frozenCreditHours ?? 0), 0);
  if (totalCredits > effectiveMax) {
    blocking.push({ code: "V2", courseCode: "", message: `This plan totals ${totalCredits} credit hours; the maximum is ${effectiveMax}.` });
  }

  // V5 -- availability. Offering must exist, belong to this semester, be
  // PUBLISHED, and (if capacity is set) have a remaining seat. This is a
  // snapshot check here -- the hard, row-locked recheck happens only
  // inside the approval transaction (edge case 6).
  for (const item of items) {
    const offering = offeringById.get(item.offeringId);
    const label = courseLabel(item.courseId);
    if (!offering || offering.semesterId !== semesterId || offering.status !== "PUBLISHED") {
      blocking.push({ code: "V5", courseCode: label, message: `${label} is not an available offering for this semester.` });
      continue;
    }
    if (offering.capacity != null) {
      const registered = await tx.query.registration.findMany({
        where: and(eq(registration.offeringId, offering.id), eq(registration.status, "REGISTERED")),
      });
      if (registered.length >= offering.capacity) {
        blocking.push({ code: "V5", courseCode: label, message: `${label} has no seats remaining.` });
      }
    }
  }

  // V6 -- schedule conflict. Reads offering_meeting for every selected
  // offering; any pair of meetings on the same day whose [start, end)
  // intervals intersect is a clash.
  const meetingRows = await tx.query.offeringMeeting.findMany({ where: inArray(offeringMeeting.offeringId, offeringIds) });
  const meetingsByOffering = new Map<string, typeof meetingRows>();
  for (const m of meetingRows) {
    const list = meetingsByOffering.get(m.offeringId) ?? [];
    list.push(m);
    meetingsByOffering.set(m.offeringId, list);
  }
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const meetingsA = meetingsByOffering.get(items[a].offeringId) ?? [];
      const meetingsB = meetingsByOffering.get(items[b].offeringId) ?? [];
      for (const ma of meetingsA) {
        for (const mb of meetingsB) {
          if (ma.dayOfWeek !== mb.dayOfWeek) continue;
          const overlap = timeToMinutes(ma.startTime) < timeToMinutes(mb.endTime) && timeToMinutes(mb.startTime) < timeToMinutes(ma.endTime);
          if (overlap) {
            const labelA = courseLabel(items[a].courseId);
            const labelB = courseLabel(items[b].courseId);
            blocking.push({
              code: "V6",
              courseCode: labelA,
              message: `${labelA} (${dayName(ma.dayOfWeek)} ${ma.startTime}-${ma.endTime}) clashes with ${labelB} (${dayName(mb.dayOfWeek)} ${mb.startTime}-${mb.endTime}).`,
            });
          }
        }
      }
    }
  }

  // V1 (prerequisites) and V3 (already completed/passed) both read the
  // student's whole academic record.
  const studentRecords = await tx.query.academicRecord.findMany({
    where: and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false)),
  });
  const semesterIds = [...new Set(studentRecords.map((r) => r.semesterId))];
  const recordSemesters = semesterIds.length > 0 ? await tx.query.semester.findMany({ where: inArray(semester.id, semesterIds) }) : [];
  const semesterStartById = new Map(recordSemesters.map((s) => [s.id, s.startDate]));
  const passingGradePoint = Number((await getSetting<string>(tx, "passing_grade_point")) ?? "0.70");

  const prereqRows = courseIds.length > 0
    ? await tx.query.coursePrerequisite.findMany({ where: inArray(coursePrerequisite.courseId, courseIds) })
    : [];
  const prereqsByCourse = new Map<string, typeof prereqRows>();
  for (const p of prereqRows) {
    const list = prereqsByCourse.get(p.courseId) ?? [];
    list.push(p);
    prereqsByCourse.set(p.courseId, list);
  }

  for (const item of items) {
    const label = courseLabel(item.courseId);

    // V1 -- every prerequisite must appear as a passed record in an
    // earlier semester. Overridable per item (REQ-P11) -- a recorded
    // override reason satisfies this item's V1 check entirely.
    if (item.prereqOverrideReason == null) {
      const prereqs = prereqsByCourse.get(item.courseId) ?? [];
      for (const prereq of prereqs) {
        const requiredGrade = prereq.minGrade != null ? Number(prereq.minGrade) : passingGradePoint;
        const prereqCourse = await tx.query.course.findFirst({ where: eq(course.id, prereq.prerequisiteCourseId) });
        const satisfied = studentRecords.some((r) => {
          if (r.courseId !== prereq.prerequisiteCourseId) return false;
          if (r.gradePoint == null || Number(r.gradePoint) < requiredGrade) return false;
          const recordSemesterStart = semesterStartById.get(r.semesterId);
          return recordSemesterStart != null && recordSemesterStart < targetSemester.startDate;
        });
        if (!satisfied) {
          if (studentRow.historicalImportStatus !== "COMPLETE") {
            blocking.push({
              code: "V1",
              courseCode: label,
              message: `${label} requires ${prereqCourse?.code ?? "a prerequisite"}, which is not recorded as passed -- prerequisite cannot be verified, this student's historical import is ${importStatusLabel(studentRow.historicalImportStatus)}.`,
            });
          } else {
            blocking.push({
              code: "V1",
              courseCode: label,
              message: `${label} requires ${prereqCourse?.code ?? "a prerequisite"}, which is not recorded as passed.`,
            });
          }
        }
      }
    }

    // V3 -- already completed and passed. A prior F never blocks (not
    // "completed and passed") and auto-flags as a retake, same as a prior
    // D+/D- in a major course -- both carry a mandatory-repeat obligation
    // and are auto-flagged rather than demanded of the student or blocked
    // (Section 14.3, edge cases 7/8: "The is_retake flag is set
    // automatically and shown to the student").
    const priorFailing = studentRecords.find((r) => {
      if (r.courseId !== item.courseId || r.isRepeatDropped) return false;
      if (r.letter === "F") return true;
      return (r.letter === "D+" || r.letter === "D-") && r.wasMajorAtRecord;
    });
    if (priorFailing && !item.isRetake) {
      item.isRetake = true; // auto-flag; not a block
    } else {
      const priorPass = studentRecords.find((r) => r.courseId === item.courseId && r.gradePoint != null && Number(r.gradePoint) >= passingGradePoint);
      if (priorPass && !item.isRetake) {
        blocking.push({
          code: "V3",
          courseCode: label,
          message: `You have already passed ${label} (grade ${priorPass.letter}). Mark it as a retake if you intend to repeat it.`,
        });
      }
    }
  }

  // V7 -- outstanding mandatory repeats not addressed by this plan.
  // Warning only, never blocks (Section 14.3: hard-blocking would strand
  // students whose historical import is incomplete, which in year one is
  // nearly all of them).
  const addressedCourseIds = new Set(items.map((i) => i.courseId));
  for (const r of studentRecords) {
    if (r.isRepeatDropped || !r.courseId) continue;
    const isObligation = r.letter === "F" || ((r.letter === "D+" || r.letter === "D-") && r.wasMajorAtRecord);
    if (isObligation && !addressedCourseIds.has(r.courseId)) {
      warnings.push({
        code: "V7",
        courseCode: r.courseCodeSnapshot,
        message: `${r.courseCodeSnapshot} must be repeated -- it is not in this plan.`,
      });
    }
  }

  return { blocking, warnings };
}

function dayName(day: number): string {
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day] ?? String(day);
}

function importStatusLabel(status: string): string {
  return { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETE: "Complete" }[status] ?? status;
}

// ---------------------------------------------------------------------------
// Student: draft plan management (Section 14.2, REQ-P01/P02)
// ---------------------------------------------------------------------------

async function assertSemesterOpenForRegistration(tx: Tx, semesterId: string): Promise<void> {
  const sem = await tx.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");
  if (sem.state !== "REGISTRATION") {
    throw new StateError(`Course planning is not currently open (semester is ${sem.state}, not Registration).`);
  }
}

/** Fetches the student's own plan for a semester, creating an empty DRAFT
 * row on first touch -- a plan only ever exists in that sense once a
 * student starts building one. Writes run through the raw connection
 * (DEV-03's pattern, same as every other write in this domain): RLS on
 * course_plan is read-only for `authenticated`, so `asUser()` could never
 * INSERT here even for a student's own row -- `assertCan` above plus the
 * ownership checks below stand in for RLS. */
export async function getOrCreateDraftPlan(actor: Actor, semesterId: string) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const existing = await tx.query.coursePlan.findFirst({
      where: and(eq(coursePlan.studentId, actor.userId), eq(coursePlan.semesterId, semesterId)),
    });
    if (existing) return existing;

    await assertSemesterOpenForRegistration(tx, semesterId);
    const [row] = await tx
      .insert(coursePlan)
      .values({ studentId: actor.userId, semesterId, status: "DRAFT" })
      .returning();
    return row;
  });
}

async function loadOwnEditablePlan(tx: Tx, actor: Actor, planId: string) {
  const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
  if (!plan) throw new ValidationError("Plan not found.");
  if (plan.studentId !== actor.userId) throw new ValidationError("Plan not found.");
  if (plan.status !== "DRAFT" && plan.status !== "REJECTED") {
    throw new StateError(`This plan cannot be edited while ${plan.status}.`);
  }
  await assertSemesterOpenForRegistration(tx, plan.semesterId);
  return plan;
}

export async function addPlanItem(actor: Actor, planId: string, offeringId: string) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const plan = await loadOwnEditablePlan(tx, actor, planId);

    const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
    if (!offering) throw new ValidationError("Offering not found.");
    if (offering.semesterId !== plan.semesterId) throw new ValidationError("That offering does not belong to this plan's semester.");

    const wasRejected = plan.status === "REJECTED";
    if (wasRejected) {
      await tx.update(coursePlan).set({ status: "DRAFT" }).where(eq(coursePlan.id, planId));
    }

    try {
      const [row] = await tx
        .insert(coursePlanItem)
        .values({ planId, offeringId, courseId: offering.courseId, isRetake: false })
        .returning();
      return row;
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") throw new ValidationError("That course is already in this plan.");
      throw err;
    }
  });
}

export async function removePlanItem(actor: Actor, planItemId: string) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Plan item not found.");
    await loadOwnEditablePlan(tx, actor, item.planId);
    await tx.delete(coursePlanItem).where(eq(coursePlanItem.id, planItemId));
  });
}

export async function setPlanItemRetake(actor: Actor, planItemId: string, isRetake: boolean) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Plan item not found.");
    await loadOwnEditablePlan(tx, actor, item.planId);
    const [row] = await tx.update(coursePlanItem).set({ isRetake }).where(eq(coursePlanItem.id, planItemId)).returning();
    return row;
  });
}

/** A DRAFT plan may be deleted by its student; once submitted, never
 * (Section 9.4.9). */
export async function deleteDraftPlan(actor: Actor, planId: string) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.studentId !== actor.userId) throw new ValidationError("Plan not found.");
    if (plan.status !== "DRAFT") throw new StateError("Only a Draft plan can be deleted.");
    await tx.delete(coursePlanItem).where(eq(coursePlanItem.planId, planId));
    await tx.delete(coursePlan).where(eq(coursePlan.id, planId));
  });
}

export interface SubmitPlanResult {
  plan: typeof coursePlan.$inferSelect;
  warnings: ValidationIssue[];
}

/**
 * REQ-P03's first enforcement point. Runs the shared validator; any
 * blocking issue refuses the whole submission with every failure named,
 * not just the first (Section 14.4).
 */
export async function submitPlan(actor: Actor, planId: string): Promise<SubmitPlanResult> {
  await assertCan(actor, "planning.manageOwnPlan");

  // Validation needs cross-student visibility (another student's
  // registration count against a shared offering) that RLS cannot grant
  // a student, so this runs through the raw connection like every other
  // complex write in this domain (DEV-03's pattern) -- assertCan above
  // and the ownership check below stand in for RLS here.
  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.studentId !== actor.userId) throw new ValidationError("Plan not found.");
    if (plan.status !== "DRAFT" && plan.status !== "REJECTED") {
      throw new StateError(`This plan cannot be submitted while ${plan.status}.`);
    }
    await assertSemesterOpenForRegistration(tx, plan.semesterId);

    const items = await tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
    const itemsForValidation: PlanItemForValidation[] = items.map((i) => ({
      id: i.id,
      offeringId: i.offeringId,
      courseId: i.courseId,
      isRetake: i.isRetake,
      prereqOverrideReason: i.prereqOverrideReason,
    }));

    const result = await validatePlan(tx, plan.studentId, plan.semesterId, itemsForValidation);
    if (result.blocking.length > 0) {
      throw new ValidationError(
        `This plan cannot be submitted: ${result.blocking.map((i) => i.message).join(" ")}`,
        result.blocking.map((i) => ({ path: i.courseCode, message: i.message })),
      );
    }

    // Persist any V3 auto-retake flags the validator set in memory.
    for (const item of itemsForValidation) {
      const original = items.find((i) => i.id === item.id);
      if (original && original.isRetake !== item.isRetake) {
        await tx.update(coursePlanItem).set({ isRetake: item.isRetake }).where(eq(coursePlanItem.id, item.id!));
      }
    }

    const totalCredits = await sumPlanCredits(tx, itemsForValidation);
    const requestId = randomUUID();

    const [row] = await tx
      .update(coursePlan)
      .set({
        status: "SUBMITTED",
        totalCredits,
        submittedAt: new Date(),
        rejectionReason: null,
        version: plan.version + 1,
      })
      .where(eq(coursePlan.id, planId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_SUBMITTED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      newValue: { totalCredits, itemCount: items.length, version: row.version },
      requestId,
    });

    return { plan: row, warnings: result.warnings };
  });
}

async function sumPlanCredits(tx: Tx, items: PlanItemForValidation[]): Promise<number> {
  const offeringIds = [...new Set(items.map((i) => i.offeringId))];
  if (offeringIds.length === 0) return 0;
  const offerings = await tx.query.courseOffering.findMany({ where: inArray(courseOffering.id, offeringIds) });
  const byId = new Map(offerings.map((o) => [o.id, o.frozenCreditHours]));
  return items.reduce((sum, i) => sum + (byId.get(i.offeringId) ?? 0), 0);
}

/** REJECTED -> DRAFT (Section 14.2). The rejection reason and reviewer
 * stay on the row until the next decision overwrites them; the audit log
 * keeps the original regardless. */
export async function revisePlan(actor: Actor, planId: string) {
  await assertCan(actor, "planning.manageOwnPlan");

  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.studentId !== actor.userId) throw new ValidationError("Plan not found.");
    if (plan.status !== "REJECTED") throw new StateError("Only a rejected plan can be revised.");

    const [row] = await tx.update(coursePlan).set({ status: "DRAFT" }).where(eq(coursePlan.id, planId)).returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_REVISED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      oldValue: { status: "REJECTED" },
      newValue: { status: "DRAFT" },
    });

    return row;
  });
}

// ---------------------------------------------------------------------------
// Admin: review, override, approve, reject (Section 14.5, REQ-P10/P11)
// ---------------------------------------------------------------------------

/**
 * REQ-P11: overridable only for V1 (prerequisites), one item at a time,
 * with a reason attached to that item -- "no 'approve anyway' button for
 * a whole plan" (Section 14.5). Allowed on any non-terminal plan (DRAFT,
 * SUBMITTED, or REJECTED), not only a SUBMITTED one under active review:
 * V1 is a BLOCKING check at submission too (Section 14.4), so a student
 * whose prerequisite genuinely cannot be verified (the overwhelmingly
 * common case in year one, Section 17.8) could never reach SUBMITTED at
 * all without an Admin being able to apply the override first.
 */
export async function overridePrerequisite(actor: Actor, planItemId: string, reason: string) {
  await assertCan(actor, "planning.reviewPlan");
  if (!reason?.trim()) throw new ValidationError("A reason is required to override a prerequisite.");

  return db.transaction(async (tx) => {
    const enabled = await getSetting<boolean>(tx, "prerequisite_override_enabled");
    const expiry = await getSetting<string>(tx, "prerequisite_override_expiry");
    if (!enabled) throw new StateError("The prerequisite override window is not open.");
    if (expiry && new Date(expiry) < new Date()) throw new StateError("The prerequisite override window has closed.");

    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Plan item not found.");
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, item.planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.status === "APPROVED") throw new StateError("This plan is already approved; nothing left to override.");

    const courseRow = await tx.query.course.findFirst({ where: eq(course.id, item.courseId) });

    const [row] = await tx
      .update(coursePlanItem)
      .set({ prereqOverrideReason: reason, prereqOverrideBy: actor.userId })
      .where(eq(coursePlanItem.id, planItemId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "PREREQUISITE_OVERRIDDEN",
      entityType: "course_plan_item",
      entityId: planItemId,
      studentId: plan.studentId,
      newValue: { courseCode: courseRow?.code, reason },
      reason,
    });

    return row;
  });
}

export interface ApprovePlanResult {
  plan: typeof coursePlan.$inferSelect;
  registrations: Array<typeof registration.$inferSelect>;
}

/**
 * REQ-P03's second enforcement point, run entirely inside one
 * transaction: re-validate, lock the plan, create one registration per
 * item, freeze credit hours, write audit entries. All succeed or none do
 * (Figure 14.1).
 */
export async function approvePlan(actor: Actor, planId: string): Promise<ApprovePlanResult> {
  await assertCan(actor, "planning.reviewPlan");

  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.status !== "SUBMITTED") throw new StateError(`Only a submitted plan can be approved (currently ${plan.status}).`);

    const studentRow = await tx.query.student.findFirst({ where: eq(student.id, plan.studentId) });
    if (!studentRow) throw new ValidationError("Student not found.");
    if (studentRow.status !== "ACTIVE") {
      throw new StateError(`This student's status is ${studentRow.status}; approval is refused.`);
    }

    const items = await tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
    if (items.length === 0) throw new ValidationError("This plan has no items.");

    // Row-locked capacity recheck (edge case 6): every offering this plan
    // touches is locked before the final validation pass, so a
    // concurrently-approving plan for a different student cannot both
    // succeed for the last seat.
    const offeringIds = [...new Set(items.map((i) => i.offeringId))];
    await tx.select().from(courseOffering).where(inArray(courseOffering.id, offeringIds)).for("update");

    const itemsForValidation: PlanItemForValidation[] = items.map((i) => ({
      id: i.id,
      offeringId: i.offeringId,
      courseId: i.courseId,
      isRetake: i.isRetake,
      prereqOverrideReason: i.prereqOverrideReason,
    }));
    const result = await validatePlan(tx, plan.studentId, plan.semesterId, itemsForValidation);
    if (result.blocking.length > 0) {
      throw new ValidationError(`This plan can no longer be approved: ${result.blocking.map((i) => i.message).join(" ")}`);
    }

    const offeringRows = await tx.query.courseOffering.findMany({ where: inArray(courseOffering.id, offeringIds) });
    const offeringById = new Map(offeringRows.map((o) => [o.id, o]));

    const requestId = randomUUID();
    const createdRegistrations: Array<typeof registration.$inferSelect> = [];

    for (const item of items) {
      const offering = offeringById.get(item.offeringId)!;
      const [reg] = await tx
        .insert(registration)
        .values({
          studentId: plan.studentId,
          offeringId: item.offeringId,
          semesterId: plan.semesterId,
          planItemId: item.id,
          source: "PLAN_APPROVAL",
          isRetake: item.isRetake,
          status: "REGISTERED",
          frozenCreditHours: offering.frozenCreditHours,
        })
        .returning();
      createdRegistrations.push(reg);

      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "REGISTRATION_CREATED",
        entityType: "registration",
        entityId: reg.id,
        studentId: plan.studentId,
        newValue: { offeringId: item.offeringId, source: "PLAN_APPROVAL", isRetake: item.isRetake },
        requestId,
      });
    }

    const totalCredits = await sumPlanCredits(tx, itemsForValidation);
    const [updatedPlan] = await tx
      .update(coursePlan)
      .set({ status: "APPROVED", totalCredits, reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(eq(coursePlan.id, planId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_APPROVED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      newValue: { totalCredits, registrationCount: createdRegistrations.length },
      requestId,
    });

    return { plan: updatedPlan, registrations: createdRegistrations };
  });
}

export async function rejectPlan(actor: Actor, planId: string, reason: string) {
  await assertCan(actor, "planning.reviewPlan");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reject a plan.");

  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.status !== "SUBMITTED") throw new StateError(`Only a submitted plan can be rejected (currently ${plan.status}).`);

    const [row] = await tx
      .update(coursePlan)
      .set({ status: "REJECTED", rejectionReason: reason, reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(eq(coursePlan.id, planId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_REJECTED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      reason,
    });

    return row;
  });
}

// ---------------------------------------------------------------------------
// Admin: direct registration and drop (DEC-14). Non-blocking warn variant
// of V1/V3/V5/V6 -- "an administrative act with a recorded reason may
// legitimately deviate; the Admin must see what they are overriding"
// (Section 14.4).
// ---------------------------------------------------------------------------

export interface DirectRegisterResult {
  registration: typeof registration.$inferSelect;
  warnings: ValidationIssue[];
}

export async function registerDirect(actor: Actor, studentId: string, offeringId: string, reason: string): Promise<DirectRegisterResult> {
  await assertCan(actor, "planning.manageRegistration");
  if (!reason?.trim()) throw new ValidationError("A reason is required for a direct registration.");

  return db.transaction(async (tx) => {
    const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
    if (!offering) throw new ValidationError("Offering not found.");
    if (offering.status !== "PUBLISHED") throw new ValidationError("Only a published offering can be registered against.");

    await tx.select().from(courseOffering).where(eq(courseOffering.id, offeringId)).for("update");

    const existing = await tx.query.registration.findFirst({
      where: and(eq(registration.studentId, studentId), eq(registration.offeringId, offeringId)),
    });
    if (existing && existing.status === "REGISTERED") throw new ValidationError("This student is already registered for this offering.");

    if (offering.capacity != null) {
      const registered = await tx.query.registration.findMany({
        where: and(eq(registration.offeringId, offeringId), eq(registration.status, "REGISTERED")),
      });
      if (registered.length >= offering.capacity) throw new ValidationError("This offering has no seats remaining.");
    }

    const validation = await validatePlan(tx, studentId, offering.semesterId, [
      { offeringId, courseId: offering.courseId, isRetake: false, prereqOverrideReason: "admin-direct" },
    ]);

    const [row] = await tx
      .insert(registration)
      .values({
        studentId,
        offeringId,
        semesterId: offering.semesterId,
        source: "ADMIN_DIRECT",
        status: "REGISTERED",
        frozenCreditHours: offering.frozenCreditHours,
      })
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "REGISTRATION_CREATED",
      entityType: "registration",
      entityId: row.id,
      studentId,
      newValue: { offeringId, source: "ADMIN_DIRECT" },
      reason,
    });

    return { registration: row, warnings: [...validation.blocking, ...validation.warnings] };
  });
}

export async function dropRegistration(actor: Actor, registrationId: string, reason: string) {
  await assertCan(actor, "planning.manageRegistration");
  if (!reason?.trim()) throw new ValidationError("A reason is required to drop a registration.");

  return db.transaction(async (tx) => {
    const existing = await tx.query.registration.findFirst({ where: eq(registration.id, registrationId) });
    if (!existing) throw new ValidationError("Registration not found.");
    if (existing.status === "DROPPED") throw new StateError("This registration has already been dropped.");

    const gradedRecord = await tx.query.academicRecord.findFirst({
      where: and(eq(academicRecord.studentId, existing.studentId), eq(academicRecord.isVoid, false)),
    });
    if (gradedRecord?.gradeRecordId) {
      throw new StateError("Cannot drop a registration once its grade is published.");
    }

    const [row] = await tx
      .update(registration)
      .set({ status: "DROPPED", droppedReason: reason })
      .where(eq(registration.id, registrationId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "REGISTRATION_DROPPED",
      entityType: "registration",
      entityId: registrationId,
      studentId: existing.studentId,
      reason,
    });

    return row;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMyPlan(actor: Actor, semesterId: string) {
  return asUser(actor.userId, (tx) =>
    tx.query.coursePlan.findFirst({ where: and(eq(coursePlan.studentId, actor.userId), eq(coursePlan.semesterId, semesterId)) }),
  );
}

export async function getPlanItems(actor: Actor, planId: string) {
  return asUser(actor.userId, (tx) => tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) }));
}

/** A-11's queue: plans awaiting a decision. */
export async function getPlanQueue(actor: Actor, semesterId: string) {
  await assertCan(actor, "planning.reviewPlan");
  return db.query.coursePlan.findMany({ where: and(eq(coursePlan.semesterId, semesterId), eq(coursePlan.status, "SUBMITTED")) });
}

export async function getPlan(actor: Actor, planId: string) {
  const isReviewer = await import("@/lib/permissions/kernel").then((k) => k.can(actor, "planning.reviewPlan"));
  if (isReviewer) {
    return db.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
  }
  await assertCan(actor, "planning.manageOwnPlan");
  return asUser(actor.userId, (tx) => tx.query.coursePlan.findFirst({ where: and(eq(coursePlan.id, planId), eq(coursePlan.studentId, actor.userId)) }));
}

export async function getRegistrationsForStudent(actor: Actor, studentId: string, semesterId?: string) {
  return asUser(actor.userId, (tx) =>
    tx.query.registration.findMany({
      where: semesterId
        ? and(eq(registration.studentId, studentId), eq(registration.semesterId, semesterId))
        : eq(registration.studentId, studentId),
    }),
  );
}

export async function getRegistrationsForOffering(actor: Actor, offeringId: string) {
  await assertCan(actor, "planning.manageRegistration");
  return db.query.registration.findMany({ where: eq(registration.offeringId, offeringId) });
}
