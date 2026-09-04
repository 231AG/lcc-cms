import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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

/**
 * Decides whose plan a call is acting on, and authorizes accordingly
 * (DEV-20). Acting on your own plan is `planning.manageOwnPlan` -- the
 * Student's own permission. Acting on someone else's is
 * `planning.manageStudentPlan`, an Admin entering a plan for a student
 * who cannot use the app themselves (Section 17.8's year-one reality: no
 * Android phone, no self-service).
 *
 * This is the ONLY difference between the two paths. Everything after it
 * -- the six validators, the credit ceiling, the state machine, the
 * approval queue -- is the same code on the same rows, so the two cannot
 * drift apart (REQ-P03's "same enforcement at both points" applied to the
 * authoring side as well).
 *
 * Deny-by-default still does the real work: a Student calling this for
 * another student's plan has no manageStudentPlan row and is refused, so
 * this is not a weaker check than the `studentId !== actor.userId`
 * comparison it replaces -- it is the same check with a second, explicitly
 * permitted case.
 */
async function authorizePlanSubject(actor: Actor, studentId: string): Promise<{ onBehalf: boolean }> {
  if (studentId === actor.userId) {
    await assertCan(actor, "planning.manageOwnPlan");
    return { onBehalf: false };
  }

  try {
    await assertCan(actor, "planning.manageStudentPlan");
  } catch (err) {
    // Preserve the pre-DEV-20 non-disclosure: a student reaching for
    // someone else's plan gets the SAME "Plan not found." as for a plan id
    // that does not exist, so the refusal is not an existence oracle. That
    // was deliberate in the code this replaces (the identical message
    // appeared on both branches in four places) and is kept here rather
    // than quietly traded for a more informative message. Staff still get
    // the real ForbiddenError, which is useful to them and discloses
    // nothing they cannot already read.
    const { can } = await import("@/lib/permissions/kernel");
    if (await can(actor, "planning.manageOwnPlan")) throw new ValidationError("Plan not found.");
    throw err;
  }
  return { onBehalf: true };
}

/** Fetches a student's plan for a semester, creating an empty DRAFT row on
 * first touch -- a plan only ever exists in that sense once someone starts
 * building one. `forStudentId` defaults to the actor, i.e. a student's own
 * plan; an Admin passes the student they are entering it for. Writes run
 * through the raw connection (DEV-03's pattern, same as every other write
 * in this domain): RLS on course_plan is read-only for `authenticated`, so
 * `asUser()` could never INSERT here even for a student's own row --
 * `authorizePlanSubject` stands in for RLS. */
export async function getOrCreateDraftPlan(actor: Actor, semesterId: string, forStudentId?: string) {
  const studentId = forStudentId ?? actor.userId;
  const { onBehalf } = await authorizePlanSubject(actor, studentId);

  return db.transaction(async (tx) => {
    if (onBehalf) {
      const subject = await tx.query.student.findFirst({ where: eq(student.id, studentId) });
      if (!subject) throw new ValidationError("Student not found.");
      if (subject.status !== "ACTIVE") {
        throw new ValidationError(`Only an active student can be registered for courses (this student is ${subject.status}).`);
      }
    }

    const existing = await tx.query.coursePlan.findFirst({
      where: and(eq(coursePlan.studentId, studentId), eq(coursePlan.semesterId, semesterId)),
    });
    if (existing) {
      // A plan the student started themselves, now being continued by the
      // office: record that the office touched it.
      if (onBehalf && existing.enteredBy !== actor.userId) {
        const [updated] = await tx
          .update(coursePlan)
          .set({ enteredBy: actor.userId })
          .where(eq(coursePlan.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }

    await assertSemesterOpenForRegistration(tx, semesterId);
    const [row] = await tx
      .insert(coursePlan)
      .values({ studentId, semesterId, status: "DRAFT", enteredBy: onBehalf ? actor.userId : null })
      .returning();

    if (onBehalf) {
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COURSE_PLAN_STARTED_FOR_STUDENT",
        entityType: "course_plan",
        entityId: row.id,
        studentId,
        newValue: { semesterId, enteredBy: actor.userId },
      });
    }
    return row;
  });
}

/** Loads a plan that the actor may edit -- their own, or (Admin, DEV-20) a
 * student's that they are entering on that student's behalf. */
async function loadEditablePlan(tx: Tx, actor: Actor, planId: string) {
  const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
  if (!plan) throw new ValidationError("Plan not found.");
  const { onBehalf } = await authorizePlanSubject(actor, plan.studentId);
  if (plan.status !== "DRAFT" && plan.status !== "REJECTED") {
    throw new StateError(`This plan cannot be edited while ${plan.status}.`);
  }
  await assertSemesterOpenForRegistration(tx, plan.semesterId);
  return { plan, onBehalf };
}

export async function addPlanItem(actor: Actor, planId: string, offeringId: string) {
  return db.transaction(async (tx) => {
    const { plan, onBehalf } = await loadEditablePlan(tx, actor, planId);
    if (onBehalf && plan.enteredBy !== actor.userId) {
      await tx.update(coursePlan).set({ enteredBy: actor.userId }).where(eq(coursePlan.id, planId));
    }

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
  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Plan item not found.");
    await loadEditablePlan(tx, actor, item.planId);
    await tx.delete(coursePlanItem).where(eq(coursePlanItem.id, planItemId));
  });
}

export async function setPlanItemRetake(actor: Actor, planItemId: string, isRetake: boolean) {
  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Plan item not found.");
    await loadEditablePlan(tx, actor, item.planId);
    const [row] = await tx.update(coursePlanItem).set({ isRetake }).where(eq(coursePlanItem.id, planItemId)).returning();
    return row;
  });
}

/** A DRAFT plan may be deleted by its student, or by an Admin who entered
 * it for them (DEV-20); once submitted, never (Section 9.4.9). */
export async function deleteDraftPlan(actor: Actor, planId: string) {
  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    await authorizePlanSubject(actor, plan.studentId);
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
  // Validation needs cross-student visibility (another student's
  // registration count against a shared offering) that RLS cannot grant
  // a student, so this runs through the raw connection like every other
  // complex write in this domain (DEV-03's pattern) -- authorizePlanSubject
  // below stands in for RLS here.
  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    const { onBehalf } = await authorizePlanSubject(actor, plan.studentId);
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
        // DEV-20: an Admin submitting for a student stamps the row here,
        // so the approval queue can show it without reading the audit log.
        ...(onBehalf ? { enteredBy: actor.userId } : {}),
      })
      .where(eq(coursePlan.id, planId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      // Kept as the same action name so every existing audit query,
      // dashboard count and export keeps working; `enteredOnBehalf`
      // distinguishes the two cases within it.
      action: "COURSE_PLAN_SUBMITTED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      newValue: { totalCredits, itemCount: items.length, version: row.version, enteredOnBehalf: onBehalf },
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
  return db.transaction(async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    await authorizePlanSubject(actor, plan.studentId);
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

export interface DecidePlanItemResult {
  item: typeof coursePlanItem.$inferSelect;
  plan: typeof coursePlan.$inferSelect;
  registration?: typeof registration.$inferSelect;
}

/** Once no item on a plan is left PENDING, its overall status rolls up from the individual decisions (DEV-19): all approved -> APPROVED, all rejected -> REJECTED, a mix -> PARTIALLY_APPROVED. Only valid to call once every item has a decision. */
function rollupPlanStatus(items: Array<{ status: string }>): "APPROVED" | "REJECTED" | "PARTIALLY_APPROVED" {
  const allApproved = items.every((i) => i.status === "APPROVED");
  const allRejected = items.every((i) => i.status === "REJECTED");
  return allApproved ? "APPROVED" : allRejected ? "REJECTED" : "PARTIALLY_APPROVED";
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

    // "Approve all" (DEV-19): decides every item still PENDING -- an item
    // already decided individually before this was clicked is left alone.
    const items = await tx.query.coursePlanItem.findMany({ where: and(eq(coursePlanItem.planId, planId), eq(coursePlanItem.status, "PENDING")) });
    if (items.length === 0) throw new ValidationError("This plan has no pending items left to approve.");

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

      await tx.update(coursePlanItem).set({ status: "APPROVED", decidedBy: actor.userId, decidedAt: new Date() }).where(eq(coursePlanItem.id, item.id));
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COURSE_PLAN_ITEM_APPROVED",
        entityType: "course_plan_item",
        entityId: item.id,
        studentId: plan.studentId,
        newValue: { offeringId: item.offeringId, registrationId: reg.id },
        requestId,
      });
    }

    const allItems = await tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
    const finalStatus = rollupPlanStatus(allItems);
    const approvedForCredit: PlanItemForValidation[] = allItems
      .filter((i) => i.status === "APPROVED")
      .map((i) => ({ offeringId: i.offeringId, courseId: i.courseId, isRetake: i.isRetake, prereqOverrideReason: i.prereqOverrideReason }));
    const totalCredits = await sumPlanCredits(tx, approvedForCredit);
    const [updatedPlan] = await tx
      .update(coursePlan)
      .set({ status: finalStatus, totalCredits, reviewedBy: actor.userId, reviewedAt: new Date() })
      .where(eq(coursePlan.id, planId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_APPROVED",
      entityType: "course_plan",
      entityId: planId,
      studentId: plan.studentId,
      newValue: { totalCredits, registrationCount: createdRegistrations.length, finalStatus },
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

    // "Reject all" (DEV-19): the same reason is applied to every item
    // still PENDING; an item already decided individually is left alone.
    const items = await tx.query.coursePlanItem.findMany({ where: and(eq(coursePlanItem.planId, planId), eq(coursePlanItem.status, "PENDING")) });
    if (items.length === 0) throw new ValidationError("This plan has no pending items left to reject.");

    for (const item of items) {
      await tx
        .update(coursePlanItem)
        .set({ status: "REJECTED", rejectionReason: reason, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(coursePlanItem.id, item.id));
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "COURSE_PLAN_ITEM_REJECTED",
        entityType: "course_plan_item",
        entityId: item.id,
        studentId: plan.studentId,
        reason,
      });
    }

    const allItems = await tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
    const finalStatus = rollupPlanStatus(allItems);
    const [row] = await tx
      .update(coursePlan)
      .set({ status: finalStatus, rejectionReason: finalStatus === "REJECTED" ? reason : plan.rejectionReason, reviewedBy: actor.userId, reviewedAt: new Date() })
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

/**
 * Per-course review (DEV-19): "one bad planned course shouldn't force
 * rejecting the entire plan." Same row-lock-and-revalidate safety as the
 * whole-plan approvePlan, scoped to a single item.
 */
export async function approvePlanItem(actor: Actor, planItemId: string): Promise<DecidePlanItemResult> {
  await assertCan(actor, "planning.reviewPlan");

  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Planned course not found.");
    if (item.status !== "PENDING") throw new StateError(`This course has already been ${item.status.toLowerCase()}.`);

    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, item.planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.status !== "SUBMITTED") throw new StateError(`Only a submitted plan's courses can be decided (currently ${plan.status}).`);

    const studentRow = await tx.query.student.findFirst({ where: eq(student.id, plan.studentId) });
    if (!studentRow) throw new ValidationError("Student not found.");
    if (studentRow.status !== "ACTIVE") {
      throw new StateError(`This student's status is ${studentRow.status}; approval is refused.`);
    }

    await tx.select().from(courseOffering).where(eq(courseOffering.id, item.offeringId)).for("update");

    const result = await validatePlan(tx, plan.studentId, plan.semesterId, [
      { id: item.id, offeringId: item.offeringId, courseId: item.courseId, isRetake: item.isRetake, prereqOverrideReason: item.prereqOverrideReason },
    ]);
    if (result.blocking.length > 0) {
      throw new ValidationError(`This course can no longer be approved: ${result.blocking.map((i) => i.message).join(" ")}`);
    }

    const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, item.offeringId) });
    if (!offering) throw new ValidationError("Offering not found.");

    const requestId = randomUUID();
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

    const [updatedItem] = await tx
      .update(coursePlanItem)
      .set({ status: "APPROVED", decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(coursePlanItem.id, planItemId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_ITEM_APPROVED",
      entityType: "course_plan_item",
      entityId: planItemId,
      studentId: plan.studentId,
      newValue: { offeringId: item.offeringId, registrationId: reg.id },
      requestId,
    });

    const updatedPlan = await resolvePlanIfComplete(tx, actor, plan.id);

    return { item: updatedItem, registration: reg, plan: updatedPlan };
  });
}

export async function rejectPlanItem(actor: Actor, planItemId: string, reason: string): Promise<DecidePlanItemResult> {
  await assertCan(actor, "planning.reviewPlan");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reject a planned course.");

  return db.transaction(async (tx) => {
    const item = await tx.query.coursePlanItem.findFirst({ where: eq(coursePlanItem.id, planItemId) });
    if (!item) throw new ValidationError("Planned course not found.");
    if (item.status !== "PENDING") throw new StateError(`This course has already been ${item.status.toLowerCase()}.`);

    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, item.planId) });
    if (!plan) throw new ValidationError("Plan not found.");
    if (plan.status !== "SUBMITTED") throw new StateError(`Only a submitted plan's courses can be decided (currently ${plan.status}).`);

    const [updatedItem] = await tx
      .update(coursePlanItem)
      .set({ status: "REJECTED", rejectionReason: reason, decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(coursePlanItem.id, planItemId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_PLAN_ITEM_REJECTED",
      entityType: "course_plan_item",
      entityId: planItemId,
      studentId: plan.studentId,
      reason,
    });

    const updatedPlan = await resolvePlanIfComplete(tx, actor, plan.id);

    return { item: updatedItem, plan: updatedPlan };
  });
}

/** Rolls the plan's own status up once no item is left PENDING (shared by approvePlanItem/rejectPlanItem); returns the plan unchanged while any item is still awaiting a decision. */
async function resolvePlanIfComplete(tx: Tx, actor: Actor, planId: string): Promise<typeof coursePlan.$inferSelect> {
  const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
  if (!plan) throw new ValidationError("Plan not found.");

  const items = await tx.query.coursePlanItem.findMany({ where: eq(coursePlanItem.planId, planId) });
  if (items.some((i) => i.status === "PENDING")) return plan;

  const finalStatus = rollupPlanStatus(items);
  const approvedForCredit: PlanItemForValidation[] = items
    .filter((i) => i.status === "APPROVED")
    .map((i) => ({ offeringId: i.offeringId, courseId: i.courseId, isRetake: i.isRetake, prereqOverrideReason: i.prereqOverrideReason }));
  const totalCredits = await sumPlanCredits(tx, approvedForCredit);
  const allRejected = finalStatus === "REJECTED";

  const [updated] = await tx
    .update(coursePlan)
    .set({
      status: finalStatus,
      totalCredits,
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
      rejectionReason: allRejected ? "Every planned course was rejected individually -- see each course's own reason." : plan.rejectionReason,
    })
    .where(eq(coursePlan.id, planId))
    .returning();

  await auditWrite(tx, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: finalStatus === "APPROVED" ? "COURSE_PLAN_APPROVED" : finalStatus === "REJECTED" ? "COURSE_PLAN_REJECTED" : "COURSE_PLAN_PARTIALLY_APPROVED",
    entityType: "course_plan",
    entityId: planId,
    studentId: plan.studentId,
    newValue: { status: finalStatus, totalCredits },
  });

  return updated;
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

/** One student's plan for one semester, read by staff (DEV-20's entry
 * screen, and the existing "look up a specific plan" lookup). Gated on
 * either planning permission an Admin may hold -- reviewing a plan and
 * entering one are separate grants, but both legitimately need to read
 * this row. RLS grants Admin all-rows read on course_plan anyway; this
 * gate is the service-layer half of Section 18.4's "service-layer scoping
 * plus RLS". */
export async function getPlanForStudentSemester(actor: Actor, studentId: string, semesterId: string) {
  const { can } = await import("@/lib/permissions/kernel");
  if (!(await can(actor, "planning.manageStudentPlan")) && !(await can(actor, "planning.reviewPlan"))) {
    await assertCan(actor, "planning.manageStudentPlan"); // throws with the standard message
  }
  return asUser(actor.userId, (tx) =>
    tx.query.coursePlan.findFirst({ where: and(eq(coursePlan.studentId, studentId), eq(coursePlan.semesterId, semesterId)) }),
  );
}

/** A-11's queue: plans awaiting a decision. */
export async function getPlanQueue(actor: Actor, semesterId: string) {
  await assertCan(actor, "planning.reviewPlan");
  return db.query.coursePlan.findMany({ where: and(eq(coursePlan.semesterId, semesterId), eq(coursePlan.status, "SUBMITTED")) });
}

/** How many plans await a decision across several semesters, counted in
 * the database in one query. The Admin home dashboard used to call
 * getPlanQueue once per active semester, sequentially, and take
 * `.length` -- a round trip per semester to fetch whole rows it then
 * discarded. */
export async function countPlansAwaitingApproval(actor: Actor, semesterIds: string[]): Promise<number> {
  await assertCan(actor, "planning.reviewPlan");
  if (semesterIds.length === 0) return 0;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coursePlan)
    .where(and(inArray(coursePlan.semesterId, semesterIds), eq(coursePlan.status, "SUBMITTED")));
  return rows[0]?.count ?? 0;
}

/** A-10's read-only "View" -- every plan a student has ever had, across semesters, with its items. Admin-only per Section 9.4.9 (Super Admin has no role in course planning). */
export async function getPlansForStudent(actor: Actor, studentId: string) {
  await assertCan(actor, "planning.reviewPlan");
  const plans = await db.query.coursePlan.findMany({ where: eq(coursePlan.studentId, studentId) });
  if (plans.length === 0) return [];
  const items = await db.query.coursePlanItem.findMany({ where: inArray(coursePlanItem.planId, plans.map((p) => p.id)) });
  const itemsByPlan = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByPlan.get(item.planId) ?? [];
    list.push(item);
    itemsByPlan.set(item.planId, list);
  }
  return plans.map((p) => ({ ...p, items: itemsByPlan.get(p.id) ?? [] }));
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
