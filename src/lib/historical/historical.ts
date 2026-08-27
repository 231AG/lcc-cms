import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import {
  academicRecord,
  academicYear,
  course,
  gradeScale,
  semester,
  student,
} from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { StateError, ValidationError } from "@/lib/errors";
import { recomputeStudentSummaries } from "@/lib/gpa/recompute";

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * The active grade scale, keyed by letter (Section 9.4.14: counts_in_gpa/
 * attempted/earned and grade_point are frozen from this at write time, not
 * looked up again later). "Active" = the highest policy version already in
 * effect -- only one version exists as of Stage 6, but this doesn't assume
 * that stays true.
 */
async function getActiveGradeScale(): Promise<Map<string, typeof gradeScale.$inferSelect>> {
  const rows = await db.query.gradeScale.findMany({
    where: (g, { lte }) => lte(g.effectiveFrom, new Date()),
  });
  if (rows.length === 0) throw new StateError("No grade scale is in effect.");
  const maxVersion = Math.max(...rows.map((r) => r.policyVersion));
  const active = rows.filter((r) => r.policyVersion === maxVersion);
  return new Map(active.map((r) => [r.letter.toUpperCase(), r]));
}

// ---------------------------------------------------------------------------
// Retrospective semester creation (ASM-15, Section 17.3/17.4)
// ---------------------------------------------------------------------------

export interface CreateRetrospectiveSemesterInput {
  academicYearId: string;
  sequence: 1 | 2;
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Historical entry is deliberately independent of the semester state
 * machine (Section 13.5): a past semester is Closed by definition, so it's
 * created directly in that state rather than walked through DRAFT -> OPEN
 * -> ... five times just to represent something that already happened.
 */
export async function createRetrospectiveSemester(actor: Actor, input: CreateRetrospectiveSemesterInput) {
  await assertCan(actor, "historical.createRetrospectiveSemester");

  const year = await db.query.academicYear.findFirst({ where: eq(academicYear.id, input.academicYearId) });
  if (!year) throw new ValidationError("Academic year not found.");

  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw new ValidationError("End date must be after start date.");
  }
  if (new Date(input.endDate) >= new Date()) {
    throw new ValidationError("A retrospective semester must have already ended.");
  }
  if (new Date(input.startDate) < new Date(year.startDate) || new Date(input.endDate) > new Date(year.endDate)) {
    throw new ValidationError("Semester dates must fall within the parent academic year.");
  }

  try {
    return await asUser(actor.userId, async (tx) => {
      const [row] = await tx
        .insert(semester)
        .values({
          academicYearId: input.academicYearId,
          sequence: input.sequence,
          name: input.name.trim(),
          state: "CLOSED",
          startDate: input.startDate,
          endDate: input.endDate,
        })
        .returning();
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "SEMESTER_CREATED",
        entityType: "semester",
        entityId: row.id,
        newValue: { academicYearId: input.academicYearId, sequence: input.sequence, name: input.name, state: "CLOSED" },
        reason: "Retrospective creation for historical import (ASM-15).",
      });
      return row;
    });
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new ValidationError(`Sequence ${input.sequence} already exists for this academic year.`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Historical entry (REQ-H01-H04, Section 17.3-17.5)
// ---------------------------------------------------------------------------

export interface HistoricalRecordInput {
  courseCode: string;
  courseTitleOverride?: string;
  creditHours: number;
  letter: string;
  score?: number;
  sourceNote?: string;
  confirmAsRepeat?: boolean;
}

export interface EnterHistoricalSemesterInput {
  studentId: string;
  semesterId: string;
  records: HistoricalRecordInput[];
}

export interface EnterHistoricalSemesterWarning {
  courseCode: string;
  message: string;
}

export interface EnterHistoricalSemesterResult {
  created: Array<typeof academicRecord.$inferSelect>;
  warnings: EnterHistoricalSemesterWarning[];
}

/**
 * One semester's worth of rows, one transaction, one save (Section 17.3).
 * Blocking checks (duplicate/conflict, unknown grade letter, implausible
 * dates) fail the whole batch so the Admin fixes everything before
 * resaving; warnings (unknown course code, score/letter mismatch) are
 * accepted and returned so the caller can surface them, matching Section
 * 17.5's "validation with blocking errors separated from acceptable
 * warnings."
 */
export async function enterHistoricalSemester(
  actor: Actor,
  input: EnterHistoricalSemesterInput,
): Promise<EnterHistoricalSemesterResult> {
  await assertCan(actor, "historical.enterRecord");

  if (input.records.length === 0) {
    throw new ValidationError("Enter at least one course.");
  }

  const studentRow = await db.query.student.findFirst({ where: eq(student.id, input.studentId) });
  if (!studentRow) throw new ValidationError("Student not found.");

  const semesterRow = await db.query.semester.findFirst({ where: eq(semester.id, input.semesterId) });
  if (!semesterRow) throw new ValidationError("Semester not found.");
  if (new Date(semesterRow.endDate) >= new Date()) {
    throw new ValidationError("Historical records can only be entered against a semester that has already ended.");
  }

  const semesterYear = new Date(semesterRow.startDate).getFullYear();
  if (semesterYear < studentRow.enrolmentYear) {
    throw new ValidationError(
      `This semester (${semesterYear}) is before the student's enrolment year (${studentRow.enrolmentYear}).`,
    );
  }

  const activeScale = await getActiveGradeScale();
  const warnings: EnterHistoricalSemesterWarning[] = [];

  // Fetched once, up front, rather than per-row -- scoped to the STUDENT
  // (every semester, not just this one): a repeat is, by definition, an
  // earlier attempt in a *different* semester, so checking only the
  // current semester would silently miss it and let two attempts of the
  // same course both land on attempt_no 1 (a real bug caught while
  // building Stage 7's recomputation tests -- attempt_no must be unique
  // per course across the student's whole history, not per semester).
  const existingRecords = await db.query.academicRecord.findMany({
    where: and(eq(academicRecord.studentId, input.studentId), eq(academicRecord.isVoid, false)),
  });
  // Highest attempt_no seen so far for a course code, across every prior
  // semester, the pre-existing rows, and rows already prepared earlier in
  // this same batch -- so a repeat gets the correct next attempt number
  // regardless of which semester it's entered against, and a duplicate is
  // refused exactly like one within a single save.
  const attemptTracker = new Map<string, number>();
  for (const r of existingRecords) {
    const key = normalizeCode(r.courseCodeSnapshot);
    attemptTracker.set(key, Math.max(attemptTracker.get(key) ?? 0, r.attemptNo));
  }

  // Looked up in parallel, once, rather than sequentially per row inside
  // the loop below -- a real semester's worth of rows (6-9 courses, per
  // Section 24.7's ergonomics concern) shouldn't take 6-9x one round trip
  // just to check the catalogue.
  const uniqueCodes = [...new Set(input.records.map((r) => normalizeCode(r.courseCode)))];
  const courseLookups = await Promise.all(
    uniqueCodes.map((code) => db.query.course.findFirst({ where: eq(course.code, code) })),
  );
  const courseByCode = new Map(uniqueCodes.map((code, i) => [code, courseLookups[i]]));

  const prepared: Array<typeof academicRecord.$inferInsert> = [];

  for (const record of input.records) {
    const code = normalizeCode(record.courseCode);
    if (!code) throw new ValidationError("Every row needs a course code.");
    if (!Number.isFinite(record.creditHours) || record.creditHours <= 0) {
      throw new ValidationError(`${code}: credit hours must be a positive number.`);
    }

    const letter = record.letter.trim().toUpperCase();
    const scaleEntry = activeScale.get(letter);
    if (!scaleEntry) {
      throw new ValidationError(
        `${code}: "${record.letter}" is not a letter in the current grade scale. A legacy grade the scale doesn't contain is a policy question for the Registrar, not a data-entry decision.`,
      );
    }

    const matchedCourse = courseByCode.get(code);
    if (!matchedCourse) {
      warnings.push({ courseCode: code, message: "Course code not found in the catalogue -- accepted with a flag." });
    }

    if (record.creditHours > 21) {
      warnings.push({ courseCode: code, message: `${record.creditHours} credit hours is unusually high -- check for a transcription error.` });
    }

    if (
      record.score !== undefined &&
      scaleEntry.minScore !== null &&
      scaleEntry.maxScore !== null &&
      (record.score < scaleEntry.minScore || record.score > scaleEntry.maxScore)
    ) {
      warnings.push({
        courseCode: code,
        message: `Score ${record.score} is outside ${letter}'s usual range (${scaleEntry.minScore}-${scaleEntry.maxScore}). Usually an error, occasionally a legitimate transfer or readmission -- add a note.`,
      });
    }

    const priorAttempt = attemptTracker.get(code);
    let attemptNo = 1;
    if (priorAttempt !== undefined) {
      if (!record.confirmAsRepeat) {
        const existingSameCourse = existingRecords.find((r) => normalizeCode(r.courseCodeSnapshot) === code);
        const existingDescription = existingSameCourse
          ? `grade ${existingSameCourse.letter}, entered ${existingSameCourse.enteredAt.toISOString().slice(0, 10)}`
          : "already submitted earlier in this same save";
        throw new ValidationError(
          `${code} already has a record for this student (${existingDescription}). Confirm as a genuine repeat to add another attempt, or remove this row if it's a duplicate.`,
        );
      }
      attemptNo = priorAttempt + 1;
    }
    attemptTracker.set(code, attemptNo);

    const wasMajorAtRecord = matchedCourse ? matchedCourse.departmentId === studentRow.departmentId : false;

    prepared.push({
      studentId: input.studentId,
      semesterId: input.semesterId,
      courseId: matchedCourse?.id ?? null,
      courseCodeSnapshot: code,
      courseTitleSnapshot: matchedCourse?.title ?? record.courseTitleOverride?.trim() ?? code,
      creditHours: String(record.creditHours),
      letter,
      gradePoint: scaleEntry.gradePoint,
      score: record.score ?? null,
      attemptNo,
      origin: "IMPORTED",
      countsInGpa: scaleEntry.countsInGpa,
      countsInAttempted: scaleEntry.countsInAttempted,
      countsInEarned: scaleEntry.countsInEarned,
      wasMajorAtRecord,
      enteredBy: actor.userId,
      sourceNote: record.sourceNote?.trim() || null,
    });
  }

  const requestId = randomUUID();

  const created = await db.transaction(async (tx) => {
    const rows: Array<typeof academicRecord.$inferSelect> = [];
    for (const values of prepared) {
      const [row] = await tx.insert(academicRecord).values(values).returning();
      rows.push(row);
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "HISTORICAL_RECORD_ENTERED",
        entityType: "academic_record",
        entityId: row.id,
        studentId: input.studentId,
        newValue: {
          courseCode: row.courseCodeSnapshot,
          creditHours: row.creditHours,
          letter: row.letter,
          attemptNo: row.attemptNo,
        },
        requestId,
      });
    }

    if (studentRow.historicalImportStatus === "NOT_STARTED") {
      await tx.update(student).set({ historicalImportStatus: "IN_PROGRESS" }).where(eq(student.id, input.studentId));
      await auditWrite(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "IMPORT_STATUS_CHANGED",
        entityType: "student",
        entityId: input.studentId,
        studentId: input.studentId,
        oldValue: { historicalImportStatus: "NOT_STARTED" },
        newValue: { historicalImportStatus: "IN_PROGRESS" },
        requestId,
      });
    }

    await recomputeStudentSummaries(tx, input.studentId);

    return rows;
  });

  return { created, warnings };
}

// ---------------------------------------------------------------------------
// Correction and voiding (Section 9.4.14, DEV-05)
// ---------------------------------------------------------------------------

export interface CorrectHistoricalRecordInput {
  creditHours?: number;
  letter?: string;
  score?: number | null;
  sourceNote?: string | null;
  reason: string;
}

export async function correctHistoricalRecord(
  actor: Actor,
  recordId: string,
  input: CorrectHistoricalRecordInput,
) {
  await assertCan(actor, "historical.correctRecord");
  if (!input.reason?.trim()) throw new ValidationError("A reason is required to correct a historical record.");

  const existing = await db.query.academicRecord.findFirst({ where: eq(academicRecord.id, recordId) });
  if (!existing) throw new ValidationError("Record not found.");
  if (existing.origin !== "IMPORTED") throw new ValidationError("Only imported records can be corrected here.");
  if (existing.isVoid) throw new ValidationError("This record has been voided; it cannot be corrected.");

  const activeScale = await getActiveGradeScale();
  const newLetter = input.letter ? input.letter.trim().toUpperCase() : existing.letter;
  const scaleEntry = activeScale.get(newLetter);
  if (!scaleEntry) throw new ValidationError(`"${input.letter}" is not a letter in the current grade scale.`);

  const newCreditHours = input.creditHours !== undefined ? String(input.creditHours) : existing.creditHours;
  const newScore = input.score === undefined ? existing.score : input.score;
  const newSourceNote = input.sourceNote === undefined ? existing.sourceNote : input.sourceNote;

  const oldValue = { creditHours: existing.creditHours, letter: existing.letter, score: existing.score };
  const newValue = { creditHours: newCreditHours, letter: newLetter, score: newScore };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(academicRecord)
      .set({
        creditHours: newCreditHours,
        letter: newLetter,
        gradePoint: scaleEntry.gradePoint,
        score: newScore,
        sourceNote: newSourceNote,
        countsInGpa: scaleEntry.countsInGpa,
        countsInAttempted: scaleEntry.countsInAttempted,
        countsInEarned: scaleEntry.countsInEarned,
      })
      .where(eq(academicRecord.id, recordId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "HISTORICAL_RECORD_CORRECTED",
      entityType: "academic_record",
      entityId: recordId,
      studentId: existing.studentId,
      oldValue,
      newValue,
      reason: input.reason,
    });

    await recomputeStudentSummaries(tx, existing.studentId);

    return row;
  });
}

export async function voidHistoricalRecord(actor: Actor, recordId: string, reason: string) {
  await assertCan(actor, "historical.voidRecord");
  if (!reason?.trim()) throw new ValidationError("A reason is required to void a historical record.");

  const existing = await db.query.academicRecord.findFirst({ where: eq(academicRecord.id, recordId) });
  if (!existing) throw new ValidationError("Record not found.");
  if (existing.isVoid) throw new ValidationError("This record has already been voided.");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(academicRecord)
      .set({ isVoid: true, voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason })
      .where(eq(academicRecord.id, recordId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "ACADEMIC_RECORD_VOIDED",
      entityType: "academic_record",
      entityId: recordId,
      studentId: existing.studentId,
      oldValue: { isVoid: false },
      reason,
    });

    await recomputeStudentSummaries(tx, existing.studentId);

    return row;
  });
}

// ---------------------------------------------------------------------------
// Import status (REQ-H04/H05, Section 17.6)
// ---------------------------------------------------------------------------

export async function markImportComplete(actor: Actor, studentId: string) {
  await assertCan(actor, "historical.setImportStatus");

  const existing = await db.query.student.findFirst({ where: eq(student.id, studentId) });
  if (!existing) throw new ValidationError("Student not found.");
  if (existing.historicalImportStatus === "COMPLETE") {
    throw new StateError("This student's import is already marked Complete.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(student)
      .set({ historicalImportStatus: "COMPLETE", importCompletedBy: actor.userId, importCompletedAt: new Date() })
      .where(eq(student.id, studentId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "IMPORT_STATUS_CHANGED",
      entityType: "student",
      entityId: studentId,
      studentId,
      oldValue: { historicalImportStatus: existing.historicalImportStatus },
      newValue: { historicalImportStatus: "COMPLETE" },
    });

    await recomputeStudentSummaries(tx, studentId);

    return row;
  });
}

export async function reopenImportStatus(actor: Actor, studentId: string, reason: string) {
  await assertCan(actor, "historical.setImportStatus");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a completed import.");

  const existing = await db.query.student.findFirst({ where: eq(student.id, studentId) });
  if (!existing) throw new ValidationError("Student not found.");
  if (existing.historicalImportStatus !== "COMPLETE") {
    throw new StateError("Only a Complete import can be reopened.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(student)
      .set({ historicalImportStatus: "IN_PROGRESS", importCompletedBy: null, importCompletedAt: null })
      .where(eq(student.id, studentId))
      .returning();

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "IMPORT_STATUS_CHANGED",
      entityType: "student",
      entityId: studentId,
      studentId,
      oldValue: { historicalImportStatus: "COMPLETE" },
      newValue: { historicalImportStatus: "IN_PROGRESS" },
      reason,
    });

    await recomputeStudentSummaries(tx, studentId);

    return row;
  });
}

// ---------------------------------------------------------------------------
// Reads (Section 17.6/20.4 -- A-10, A-16)
// ---------------------------------------------------------------------------

export async function getStudentHistory(actor: Actor, studentId: string) {
  return asUser(actor.userId, (tx) =>
    tx.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false)),
      orderBy: (r, { asc }) => [asc(r.semesterId), asc(r.courseCodeSnapshot)],
    }),
  );
}

export interface ImportProgressReport {
  byStatus: Record<string, number>;
  totalStudents: number;
  unknownCourseIssues: number;
}

/**
 * Institution-level counts (REQ-H06). Not assertCan-gated -- the A-16 page
 * decides who sees the link (Admin, and Super Admin read-only), same
 * pattern as every other admin read screen in this codebase.
 */
export async function getImportProgressReport(actor: Actor): Promise<ImportProgressReport> {
  return asUser(actor.userId, async (tx) => {
    const students = await tx.query.student.findMany();
    const byStatus: Record<string, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETE: 0 };
    for (const s of students) {
      byStatus[s.historicalImportStatus] = (byStatus[s.historicalImportStatus] ?? 0) + 1;
    }

    const unknownCourseRows = await tx.query.academicRecord.findMany({
      where: and(isNull(academicRecord.courseId), eq(academicRecord.isVoid, false)),
    });

    return {
      byStatus,
      totalStudents: students.length,
      unknownCourseIssues: unknownCourseRows.length,
    };
  });
}
