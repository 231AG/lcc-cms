import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import {
  academicRecord,
  course,
  courseOffering,
  gradeCorrectionRequest,
  gradeRecord,
  gradeSubmission,
  registration,
  semester,
  student,
} from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { listName } from "@/lib/students/name";
import { isGradeEntryOpen, SEMESTER_STATE_LABEL, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { ConflictError, StateError, ValidationError } from "@/lib/errors";
import { runIdempotent } from "@/lib/tx/idempotent";
import { deriveLetterFromScore, roundHalfUp, type GradeScaleEntry } from "@/lib/gpa/engine";
import { recomputeStudentSummaries } from "@/lib/gpa/recompute";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getActiveGradeScale(tx: Tx): Promise<GradeScaleEntry[]> {
  const rows = await tx.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) });
  if (rows.length === 0) throw new StateError("No grade scale is in effect.");
  const maxVersion = Math.max(...rows.map((r) => r.policyVersion));
  return rows.filter((r) => r.policyVersion === maxVersion);
}

async function assertSemesterInGradeSubmission(tx: Tx, semesterId: string): Promise<void> {
  const sem = await tx.query.semester.findFirst({ where: eq(semester.id, semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");
  if (!isGradeEntryOpen(sem.state as SemesterState)) {
    throw new StateError(
      `Grades can only be entered while the semester is In Progress -- this one is ${SEMESTER_STATE_LABEL[sem.state as SemesterState]}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ClassRosterRow {
  registrationId: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  isRetake: boolean;
  grade: typeof gradeRecord.$inferSelect | null;
}

/** A-12/A-18's source: every REGISTERED student for an offering, in the
 * same order every time (surname, per Section 20.6's "matches the printed
 * sheet exactly"), with whatever grade_record already exists for them. */
export async function getClassRoster(actor: Actor, offeringId: string): Promise<ClassRosterRow[]> {
  await assertCan(actor, "grade.manageClass");

  return asUser(actor.userId, async (tx) => {
    const regs = await tx.query.registration.findMany({
      where: and(eq(registration.offeringId, offeringId), eq(registration.status, "REGISTERED")),
    });
    const studentIds = regs.map((r) => r.studentId);
    const students = studentIds.length ? await tx.query.student.findMany({ where: inArray(student.id, studentIds) }) : [];
    const regIds = regs.map((r) => r.id);
    const grades = regIds.length ? await tx.query.gradeRecord.findMany({ where: inArray(gradeRecord.registrationId, regIds) }) : [];

    return regs
      .map((r) => {
        const s = students.find((s) => s.id === r.studentId);
        return {
          registrationId: r.id,
          studentId: r.studentId,
          studentNumber: s?.studentNumber ?? "",
          studentName: s ? listName(s) : r.studentId,
          isRetake: r.isRetake,
          grade: grades.find((g) => g.registrationId === r.id) ?? null,
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  });
}

export async function getSubmissionQueue(actor: Actor) {
  await assertCan(actor, "grade.review");
  return db.query.gradeSubmission.findMany({
    where: inArray(gradeSubmission.status, ["SUBMITTED", "PARTIALLY_DECIDED"]),
  });
}

export async function getSubmissionDetail(actor: Actor, submissionId: string) {
  const isReviewer = await import("@/lib/permissions/kernel").then((k) => k.can(actor, "grade.review"));
  if (!isReviewer) await assertCan(actor, "grade.manageClass");

  const submission = await db.query.gradeSubmission.findFirst({ where: eq(gradeSubmission.id, submissionId) });
  if (!submission) return null;
  const grades = await db.query.gradeRecord.findMany({ where: eq(gradeRecord.submissionId, submissionId) });
  return { submission, grades };
}

export async function getCorrectionQueue(actor: Actor) {
  await assertCan(actor, "grade.decideCorrection");
  return db.query.gradeCorrectionRequest.findMany({ where: eq(gradeCorrectionRequest.status, "PENDING") });
}

// ---------------------------------------------------------------------------
// Draft entry and submission (Section 15.2/15.3, A-12)
// ---------------------------------------------------------------------------

export interface DraftGradeEntry {
  registrationId: string;
  /** Omit for Incomplete. 0-100, at most one decimal. */
  score?: number;
  isIncomplete?: boolean;
  /** The version last seen by the client, for a row that already exists.
   * Omitted for a registration with no grade_record yet. */
  expectedVersion?: number;
}

/**
 * Section 15.3's save behaviour: the whole class saves as one
 * transaction, never row by row -- a dropped connection must never leave
 * a half-entered class. A version mismatch on any row refuses the whole
 * save and names every conflicting row, rather than silently overwriting
 * or discarding either side's work.
 */
export async function saveClassDraft(
  actor: Actor,
  offeringId: string,
  entries: DraftGradeEntry[],
  idempotencyKey: string,
): Promise<Array<typeof gradeRecord.$inferSelect>> {
  await assertCan(actor, "grade.manageClass");

  return runIdempotent({
    key: idempotencyKey,
    operation: "grades.saveClassDraft",
    actorUserId: actor.userId,
    requestPayload: { offeringId, entries },
    run: async (tx) => {
      const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
      if (!offering) throw new ValidationError("Offering not found.");
      await assertSemesterInGradeSubmission(tx, offering.semesterId);

      const regIds = entries.map((e) => e.registrationId);
      const regs = await tx.query.registration.findMany({ where: inArray(registration.id, regIds) });
      const regById = new Map(regs.map((r) => [r.id, r]));
      for (const e of entries) {
        const reg = regById.get(e.registrationId);
        if (!reg || reg.offeringId !== offeringId || reg.status !== "REGISTERED") {
          throw new ValidationError(`Registration ${e.registrationId} is not a registered student in this offering.`);
        }
      }

      const existing = await tx.query.gradeRecord.findMany({ where: inArray(gradeRecord.registrationId, regIds) });
      const existingByReg = new Map(existing.map((g) => [g.registrationId, g]));

      const conflicts: string[] = [];
      for (const e of entries) {
        const current = existingByReg.get(e.registrationId);
        if (current && current.status !== "DRAFT") {
          throw new ValidationError(`A grade already exists for this registration and is no longer a draft (status ${current.status}) -- use a correction instead.`);
        }
        if (current && e.expectedVersion !== undefined && current.version !== e.expectedVersion) {
          conflicts.push(e.registrationId);
        }
      }
      if (conflicts.length > 0) {
        throw new ConflictError(
          `${conflicts.length} row(s) changed since you loaded this class: ${conflicts.join(", ")}. Reload and reapply your changes to those rows.`,
        );
      }

      const scale = await getActiveGradeScale(tx);
      const saved: Array<typeof gradeRecord.$inferSelect> = [];

      for (const e of entries) {
        let letter: string;
        let gradePointStr: string | null;
        let scoreStr: string | null;
        if (e.isIncomplete) {
          const entry = scale.find((s) => s.letter === "I");
          if (!entry) throw new StateError("The active grade scale has no Incomplete entry.");
          letter = "I";
          gradePointStr = null;
          scoreStr = null;
        } else {
          if (e.score === undefined) throw new ValidationError(`A score or Incomplete is required for registration ${e.registrationId}.`);
          const derived = deriveLetterFromScore(e.score, scale);
          letter = derived.letter;
          gradePointStr = derived.gradePoint;
          scoreStr = roundHalfUp(e.score, 1);
        }

        const current = existingByReg.get(e.registrationId);
        if (current) {
          const [row] = await tx
            .update(gradeRecord)
            .set({ score: scoreStr, letter, gradePoint: gradePointStr, version: current.version + 1 })
            .where(eq(gradeRecord.id, current.id))
            .returning();
          saved.push(row);
        } else {
          const [row] = await tx
            .insert(gradeRecord)
            .values({ registrationId: e.registrationId, score: scoreStr, letter, gradePoint: gradePointStr, status: "DRAFT", enteredBy: actor.userId })
            .returning();
          saved.push(row);
          await auditWrite(tx, {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: "GRADE_ENTERED",
            entityType: "grade_record",
            entityId: row.id,
            studentId: regById.get(e.registrationId)!.studentId,
            newValue: { letter, score: scoreStr },
          });
        }
      }

      return saved;
    },
  });
}

/** Clears a DRAFT grade back to blank -- deletes the row, since a blank
 * registration is simply the absence of one (Section 15.2's "clear"). */
export async function clearDraftGrade(actor: Actor, gradeRecordId: string): Promise<void> {
  await assertCan(actor, "grade.manageClass");

  return db.transaction(async (tx) => {
    const existing = await tx.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, gradeRecordId) });
    if (!existing) throw new ValidationError("Grade not found.");
    if (existing.status !== "DRAFT") throw new StateError("Only a draft grade can be cleared.");

    await tx.delete(gradeRecord).where(eq(gradeRecord.id, gradeRecordId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "GRADE_DRAFT_CLEARED",
      entityType: "grade_record",
      entityId: gradeRecordId,
      oldValue: { letter: existing.letter, score: existing.score },
    });
  });
}

export interface SubmitClassResult {
  submission: typeof gradeSubmission.$inferSelect;
}

/**
 * Section 15.3/9.4.11: a submission may only be created when every
 * registered student has a draft grade, or the Admin explicitly confirms
 * a partial submission with a recorded note -- silent partial submission
 * is not allowed.
 */
export async function submitClass(
  actor: Actor,
  offeringId: string,
  input: { confirmPartial?: boolean; partialNote?: string },
  idempotencyKey: string,
): Promise<SubmitClassResult> {
  await assertCan(actor, "grade.manageClass");

  return runIdempotent({
    key: idempotencyKey,
    operation: "grades.submitClass",
    actorUserId: actor.userId,
    requestPayload: { offeringId, input },
    run: async (tx) => {
      const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
      if (!offering) throw new ValidationError("Offering not found.");
      await assertSemesterInGradeSubmission(tx, offering.semesterId);

      const regs = await tx.query.registration.findMany({
        where: and(eq(registration.offeringId, offeringId), eq(registration.status, "REGISTERED")),
      });
      if (regs.length === 0) throw new ValidationError("This class has no registered students.");

      const regIds = regs.map((r) => r.id);
      const drafts = await tx.query.gradeRecord.findMany({ where: and(inArray(gradeRecord.registrationId, regIds), eq(gradeRecord.status, "DRAFT")) });
      const draftedRegIds = new Set(drafts.map((g) => g.registrationId));
      const missing = regs.filter((r) => !draftedRegIds.has(r.id));

      if (missing.length > 0 && !input.confirmPartial) {
        throw new ValidationError(
          `${missing.length} of ${regs.length} students have no grade yet. Complete them, or confirm a partial submission with a note.`,
        );
      }
      if (missing.length > 0 && !input.partialNote?.trim()) {
        throw new ValidationError("A note is required to confirm a partial submission.");
      }
      if (drafts.length === 0) throw new ValidationError("There are no draft grades to submit.");

      const priorSubmissions = await tx.query.gradeSubmission.findMany({ where: eq(gradeSubmission.offeringId, offeringId) });
      const nextAttemptNo = priorSubmissions.length === 0 ? 1 : Math.max(...priorSubmissions.map((s) => s.attemptNo)) + 1;

      let submissionRow: typeof gradeSubmission.$inferSelect;
      try {
        [submissionRow] = await tx
          .insert(gradeSubmission)
          .values({
            offeringId,
            attemptNo: nextAttemptNo,
            status: "SUBMITTED",
            submittedBy: actor.userId,
            gradeCount: drafts.length,
            undecidedCount: drafts.length,
          })
          .returning();
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "23505") throw new ValidationError("This class already has a submission awaiting a decision.");
        throw err;
      }

      for (const g of drafts) {
        await tx.update(gradeRecord).set({ status: "SUBMITTED", submissionId: submissionRow.id }).where(eq(gradeRecord.id, g.id));
      }

      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "GRADE_SUBMISSION_CREATED",
        entityType: "grade_submission",
        entityId: submissionRow.id,
        newValue: { offeringId, gradeCount: drafts.length, missingCount: missing.length, partialNote: input.partialNote ?? null },
      });

      return { submission: submissionRow };
    },
  });
}

// ---------------------------------------------------------------------------
// Approval and rejection (Section 15.1/15.2.1/15.4, "the largest
// transaction in the system")
// ---------------------------------------------------------------------------

export interface DecisionResult {
  submission: typeof gradeSubmission.$inferSelect;
  affectedGradeIds: string[];
}

async function upsertSystemAcademicRecord(
  tx: Tx,
  g: typeof gradeRecord.$inferSelect,
  reg: typeof registration.$inferSelect,
): Promise<void> {
  const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, reg.offeringId) });
  if (!offering) throw new ValidationError("Offering not found.");
  const courseRow = await tx.query.course.findFirst({ where: eq(course.id, offering.courseId) });
  if (!courseRow) throw new ValidationError("Course not found.");
  const studentRow = await tx.query.student.findFirst({ where: eq(student.id, reg.studentId) });
  if (!studentRow) throw new ValidationError("Student not found.");
  const scaleEntry = (await getActiveGradeScale(tx)).find((s) => s.letter === g.letter);
  if (!scaleEntry) throw new StateError(`"${g.letter}" is not in the active grade scale.`);

  // Attempt number: next after the highest existing (non-void) attempt
  // for this student+course, matching Stage 6's own scoping (whole
  // history, not just this semester) so a repeat in any semester numbers
  // correctly.
  const priorAttempts = await tx.query.academicRecord.findMany({
    where: and(eq(academicRecord.studentId, reg.studentId), eq(academicRecord.isVoid, false)),
  });
  const sameCourse = priorAttempts.filter((r) => r.courseCodeSnapshot.trim().toUpperCase() === courseRow.code.trim().toUpperCase());
  const attemptNo = sameCourse.length === 0 ? 1 : Math.max(...sameCourse.map((r) => r.attemptNo)) + 1;

  const existingForGrade = await tx.query.academicRecord.findFirst({ where: eq(academicRecord.gradeRecordId, g.id) });

  const values = {
    studentId: reg.studentId,
    semesterId: offering.semesterId,
    courseId: courseRow.id,
    courseCodeSnapshot: courseRow.code,
    courseTitleSnapshot: courseRow.title,
    creditHours: String(reg.frozenCreditHours),
    letter: g.letter,
    gradePoint: scaleEntry.gradePoint,
    score: g.score !== null ? Math.round(Number(g.score)) : null,
    attemptNo,
    origin: "SYSTEM" as const,
    gradeRecordId: g.id,
    countsInGpa: scaleEntry.countsInGpa,
    countsInAttempted: scaleEntry.countsInAttempted,
    countsInEarned: scaleEntry.countsInEarned,
    wasMajorAtRecord: courseRow.departmentId === studentRow.departmentId,
    enteredBy: g.decidedBy ?? g.enteredBy,
  };

  if (existingForGrade) {
    await tx
      .update(academicRecord)
      .set({ letter: values.letter, gradePoint: values.gradePoint, score: values.score, countsInGpa: values.countsInGpa, countsInAttempted: values.countsInAttempted, countsInEarned: values.countsInEarned })
      .where(eq(academicRecord.id, existingForGrade.id));
  } else {
    await tx.insert(academicRecord).values(values);
  }
}

async function decideGrades(
  tx: Tx,
  actor: Actor,
  submissionId: string,
  gradeRecordIds: string[] | undefined,
  decision: "APPROVE" | "REJECT",
  reason: string | undefined,
  requestId: string,
): Promise<DecisionResult> {
  const [submission] = await tx.select().from(gradeSubmission).where(eq(gradeSubmission.id, submissionId)).for("update");
  if (!submission) throw new ValidationError("Submission not found.");
  if (submission.status !== "SUBMITTED" && submission.status !== "PARTIALLY_DECIDED") {
    throw new StateError(`This submission is already ${submission.status}; there is nothing left to decide.`);
  }
  if (submission.submittedBy === actor.userId) {
    throw new StateError("You cannot decide a submission you submitted yourself.");
  }

  const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, submission.offeringId) });
  if (!offering) throw new ValidationError("Offering not found.");
  await assertSemesterInGradeSubmission(tx, offering.semesterId);

  const undecided = await tx.query.gradeRecord.findMany({
    where: and(eq(gradeRecord.submissionId, submissionId), eq(gradeRecord.status, "SUBMITTED")),
  });
  const targeted = gradeRecordIds ? undecided.filter((g) => gradeRecordIds.includes(g.id)) : undecided;
  if (targeted.length === 0) throw new ValidationError("No undecided grades match this decision.");
  if (decision === "REJECT" && !reason?.trim()) throw new ValidationError("A reason is required to reject a grade.");

  const affectedGradeIds: string[] = [];
  const affectedStudentIds = new Set<string>();

  for (const g of targeted) {
    const reg = await tx.query.registration.findFirst({ where: eq(registration.id, g.registrationId) });
    if (!reg) throw new ValidationError("Registration not found.");

    if (decision === "APPROVE") {
      const [updated] = await tx
        .update(gradeRecord)
        .set({ status: "PUBLISHED", publishedAt: new Date(), lockedAt: new Date(), decidedBy: actor.userId, decidedAt: new Date(), version: g.version + 1 })
        .where(eq(gradeRecord.id, g.id))
        .returning();
      await upsertSystemAcademicRecord(tx, updated, reg);
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "GRADE_PUBLISHED",
        entityType: "grade_record",
        entityId: g.id,
        studentId: reg.studentId,
        newValue: { letter: g.letter },
        requestId,
      });
    } else {
      await tx
        .update(gradeRecord)
        .set({ status: "DRAFT", submissionId: null, decidedBy: actor.userId, decidedAt: new Date(), decisionReason: reason, version: g.version + 1 })
        .where(eq(gradeRecord.id, g.id));
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "GRADE_SUBMISSION_REJECTED",
        entityType: "grade_record",
        entityId: g.id,
        studentId: reg.studentId,
        reason,
        requestId,
      });
    }

    affectedGradeIds.push(g.id);
    affectedStudentIds.add(reg.studentId);
  }

  for (const studentId of affectedStudentIds) {
    await recomputeStudentSummaries(tx, studentId);
  }

  const stillUndecided = await tx.query.gradeRecord.findMany({
    where: and(eq(gradeRecord.submissionId, submissionId), eq(gradeRecord.status, "SUBMITTED")),
  });
  const newStatus = stillUndecided.length === 0 ? "CLOSED" : "PARTIALLY_DECIDED";
  const [updatedSubmission] = await tx
    .update(gradeSubmission)
    .set({
      status: newStatus,
      undecidedCount: stillUndecided.length,
      reviewedBy: submission.reviewedBy ?? actor.userId,
      reviewedAt: submission.reviewedAt ?? new Date(),
    })
    .where(eq(gradeSubmission.id, submissionId))
    .returning();

  await auditWrite(tx, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: decision === "APPROVE" ? "GRADE_SUBMISSION_APPROVED" : "GRADE_SUBMISSION_REJECTED",
    entityType: "grade_submission",
    entityId: submissionId,
    newValue: { decision, gradeCount: targeted.length, newStatus },
    reason,
    requestId,
  });

  return { submission: updatedSubmission, affectedGradeIds };
}

/**
 * Figure 15.1's numbered steps, all inside one transaction: lock the
 * submission, re-assert reviewer != submitter and semester state, publish
 * and lock every targeted grade, write one academic_record per grade,
 * recompute GPA/CGPA per affected student, write audit entries. All
 * succeed or none do (§8.3.2).
 */
export async function approveSubmission(
  actor: Actor,
  submissionId: string,
  gradeRecordIds: string[] | undefined,
  idempotencyKey: string,
): Promise<DecisionResult> {
  await assertCan(actor, "grade.review");
  const requestId = randomUUID();

  return runIdempotent({
    key: idempotencyKey,
    operation: "grades.approveSubmission",
    actorUserId: actor.userId,
    requestPayload: { submissionId, gradeRecordIds },
    run: (tx) => decideGrades(tx, actor, submissionId, gradeRecordIds, "APPROVE", undefined, requestId),
  });
}

export async function rejectSubmission(
  actor: Actor,
  submissionId: string,
  gradeRecordIds: string[] | undefined,
  reason: string,
  idempotencyKey: string,
): Promise<DecisionResult> {
  await assertCan(actor, "grade.review");
  const requestId = randomUUID();

  return runIdempotent({
    key: idempotencyKey,
    operation: "grades.rejectSubmission",
    actorUserId: actor.userId,
    requestPayload: { submissionId, gradeRecordIds, reason },
    run: (tx) => decideGrades(tx, actor, submissionId, gradeRecordIds, "REJECT", reason, requestId),
  });
}

// ---------------------------------------------------------------------------
// Correction workflow (Section 15.5, 9.4.13, REQ-G08 -- mandatory two-key,
// unlike Stage 6's direct-Admin historical correction, DEV-05)
// ---------------------------------------------------------------------------

export interface RequestCorrectionInput {
  newScore?: number;
  isIncomplete?: boolean;
  reason: string;
}

export async function requestCorrection(actor: Actor, gradeRecordId: string, input: RequestCorrectionInput) {
  await assertCan(actor, "grade.requestCorrection");
  if (!input.reason?.trim()) throw new ValidationError("A reason is required to request a correction.");

  return db.transaction(async (tx) => {
    const existing = await tx.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, gradeRecordId) });
    if (!existing) throw new ValidationError("Grade not found.");
    if (existing.status !== "PUBLISHED" && existing.status !== "LOCKED") {
      throw new StateError("Only a published, locked grade can be corrected.");
    }
    const reg = await tx.query.registration.findFirst({ where: eq(registration.id, existing.registrationId) });
    if (!reg) throw new ValidationError("Registration not found.");
    const offering = await tx.query.courseOffering.findFirst({ where: eq(courseOffering.id, reg.offeringId) });
    if (!offering) throw new ValidationError("Offering not found.");
    const sem = await tx.query.semester.findFirst({ where: eq(semester.id, offering.semesterId) });
    if (!sem) throw new ValidationError("Semester not found.");
    if (sem.state === "CLOSED") {
      throw new StateError("This semester is Closed; a Super Admin must reopen it before a correction can be requested.");
    }
    if (!isGradeEntryOpen(sem.state as SemesterState)) {
      throw new StateError(
        `Corrections can only be made while the semester is In Progress -- this one is ${SEMESTER_STATE_LABEL[sem.state as SemesterState]}.`,
      );
    }

    const scale = await getActiveGradeScale(tx);
    let newLetter: string;
    let newGradePointStr: string | null;
    let newScoreStr: string | null;
    if (input.isIncomplete) {
      newLetter = "I";
      newGradePointStr = null;
      newScoreStr = null;
    } else {
      if (input.newScore === undefined) throw new ValidationError("A new score or Incomplete is required.");
      const derived = deriveLetterFromScore(input.newScore, scale);
      newLetter = derived.letter;
      newGradePointStr = derived.gradePoint;
      newScoreStr = roundHalfUp(input.newScore, 1);
    }

    let row;
    try {
      [row] = await tx
        .insert(gradeCorrectionRequest)
        .values({
          gradeRecordId,
          oldScore: existing.score,
          oldLetter: existing.letter,
          oldGradePoint: existing.gradePoint,
          newScore: newScoreStr,
          newLetter,
          newGradePoint: newGradePointStr,
          reason: input.reason,
          requestedBy: actor.userId,
          status: "PENDING",
        })
        .returning();
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") throw new ValidationError("A correction request is already pending for this grade.");
      throw err;
    }

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "GRADE_CORRECTION_REQUESTED",
      entityType: "grade_correction_request",
      entityId: row.id,
      studentId: reg.studentId,
      oldValue: { letter: existing.letter, score: existing.score },
      newValue: { letter: newLetter, score: newScoreStr },
      reason: input.reason,
    });

    return row;
  });
}

export async function decideCorrection(actor: Actor, correctionRequestId: string, decision: "APPROVE" | "REJECT", note?: string) {
  await assertCan(actor, "grade.decideCorrection");

  return db.transaction(async (tx) => {
    const request = await tx.query.gradeCorrectionRequest.findFirst({ where: eq(gradeCorrectionRequest.id, correctionRequestId) });
    if (!request) throw new ValidationError("Correction request not found.");
    if (request.status !== "PENDING") throw new StateError(`This request is already ${request.status}.`);
    if (request.requestedBy === actor.userId) throw new StateError("You cannot decide a correction you requested yourself.");

    const grade = await tx.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, request.gradeRecordId) });
    if (!grade) throw new ValidationError("Grade not found.");

    // Staleness check (Section 15.5): the grade must be unchanged since
    // the request captured its old values, or the request is rejected as
    // stale rather than applied blindly.
    const stale = grade.letter !== request.oldLetter || grade.score !== request.oldScore || grade.gradePoint !== request.oldGradePoint;
    if (stale && decision === "APPROVE") {
      await tx
        .update(gradeCorrectionRequest)
        .set({ status: "REJECTED", decidedBy: actor.userId, decidedAt: new Date(), decisionNote: "Automatically rejected as stale: the grade changed after this request was made." })
        .where(eq(gradeCorrectionRequest.id, correctionRequestId));
      throw new ConflictError("This grade changed since the correction was requested. The request has been rejected as stale; ask the Admin to request again against the current value.");
    }

    const [updatedRequest] = await tx
      .update(gradeCorrectionRequest)
      .set({ status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note ?? null })
      .where(eq(gradeCorrectionRequest.id, correctionRequestId))
      .returning();

    const reg = await tx.query.registration.findFirst({ where: eq(registration.id, grade.registrationId) });
    if (!reg) throw new ValidationError("Registration not found.");

    if (decision === "APPROVE") {
      const [updatedGrade] = await tx
        .update(gradeRecord)
        .set({ score: request.newScore, letter: request.newLetter, gradePoint: request.newGradePoint, lockedAt: new Date(), version: grade.version + 1 })
        .where(eq(gradeRecord.id, grade.id))
        .returning();
      await upsertSystemAcademicRecord(tx, updatedGrade, reg);
      await recomputeStudentSummaries(tx, reg.studentId);

      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "GRADE_CORRECTION_APPROVED",
        entityType: "grade_correction_request",
        entityId: correctionRequestId,
        studentId: reg.studentId,
        oldValue: { letter: request.oldLetter, score: request.oldScore },
        newValue: { letter: request.newLetter, score: request.newScore },
        reason: request.reason,
      });
    } else {
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "GRADE_CORRECTION_REJECTED",
        entityType: "grade_correction_request",
        entityId: correctionRequestId,
        studentId: reg.studentId,
        reason: note,
      });
    }

    return updatedRequest;
  });
}
