import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import {
  academicRecord,
  academicYear,
  course,
  semester,
  student,
  studentCumulativeSummary,
  studentSemesterSummary,
} from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";
import { recomputeStudentSummaries } from "@/lib/gpa/recompute";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";
import { fullName } from "@/lib/students/name";
import { semesterFullLabel } from "@/lib/academic/semesterName";

/**
 * Editing a whole past semester, the way it was entered (past-grades editor).
 *
 * The Admin sees the semester's imported grades as a grid and may change any
 * course, grade or credit hours, remove a row, add a row, or add a course to
 * the catalogue. One reason covers the save. Everything -- catalogue
 * additions, edits, removals, additions, summaries -- happens in ONE
 * transaction, so a refusal part-way leaves nothing behind.
 *
 * "Check" runs the very same code as "Save" inside a transaction that is then
 * rolled back, so the GPA and CGPA it reports are exactly what saving would
 * produce, not a second implementation of the arithmetic.
 *
 * Removing is voiding (hidden from the transcript and the GPA, kept in the
 * record with who, when and why). Only IMPORTED records are editable here;
 * grades published through the system change through Grade corrections.
 */

export type SemesterEditNewCourse =
  | { mode: "catalogue"; title: string; departmentId: string }
  | { mode: "asPrinted"; title: string };

export interface SemesterEditRow {
  /** The existing record this row edits; absent for a row being added. */
  recordId?: string;
  code: string;
  creditHours: number;
  letter: string;
  /** Needed only when the code is not in the catalogue. */
  newCourse?: SemesterEditNewCourse;
}

export interface SemesterEditInput {
  studentId: string;
  semesterId: string;
  rows: SemesterEditRow[];
  reason: string;
  /** Ticks the points in `toConfirm`. */
  confirmed?: boolean;
}

export interface SemesterEditChange {
  kind: "added" | "changed" | "removed" | "unchanged";
  code: string;
  title: string;
  before: { creditHours: string; letter: string } | null;
  after: { creditHours: string; letter: string } | null;
  /** What differs, in words: "grade B → A", "course ACCT 101 → ACCT 102". */
  detail: string;
}

export interface SemesterEditCheck {
  student: { id: string; name: string; studentNumber: string };
  semester: { id: string; label: string };
  changes: SemesterEditChange[];
  /** Courses that saving will add to the catalogue. */
  newCourses: string[];
  /** Grades in this semester that came from the system; shown, never edited. */
  locked: Array<{ code: string; title: string; letter: string; creditHours: string }>;
  summary: {
    before: { semesterGpa: number | null; cgpa: number | null; credits: number };
    after: { semesterGpa: number | null; cgpa: number | null; credits: number };
  };
  problems: string[];
  toConfirm: string[];
  /** True when there is nothing to save. */
  unchanged: boolean;
}

export interface SemesterEditResult {
  semester: string;
  added: number;
  changed: number;
  removed: number;
  createdCourses: string[];
  createdCourseCodes: string[];
}

class DryRun extends Error {
  constructor(public readonly check: SemesterEditCheck) {
    super("dry run");
  }
}

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1))));
const storedForm = (code: string) => code.replace(/\s+/g, "").toUpperCase();
const MAX_ROWS = 20;

async function activeScale() {
  const rows = await db.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) });
  if (rows.length === 0) throw new ValidationError("No grade scale is in effect.");
  const v = Math.max(...rows.map((r) => r.policyVersion));
  return new Map(rows.filter((r) => r.policyVersion === v).map((r) => [r.letter.toUpperCase(), r]));
}

/**
 * Checks and applies, inside `tx`. Returns the check; the caller decides
 * whether to commit (save) or roll back (check).
 */
async function run(
  tx: Tx,
  actor: Actor,
  input: SemesterEditInput,
  mode: "check" | "save",
): Promise<{ check: SemesterEditCheck; result: SemesterEditResult | null }> {
  const stu = await tx.query.student.findFirst({ where: eq(student.id, input.studentId) });
  if (!stu) throw new ValidationError("Student not found.");
  const sem = await tx.query.semester.findFirst({ where: eq(semester.id, input.semesterId) });
  if (!sem) throw new ValidationError("Semester not found.");
  const year = await tx.query.academicYear.findFirst({ where: eq(academicYear.id, sem.academicYearId) });
  const label = semesterFullLabel(year, sem, "this semester");
  if (new Date(sem.endDate) >= new Date()) {
    throw new ValidationError("Past grades can only be edited for a semester that has already ended.");
  }

  const [scale, catalogue, departments, allRecords] = await Promise.all([
    activeScale(),
    tx.query.course.findMany({ columns: { id: true, code: true, title: true, creditHours: true, departmentId: true } }),
    tx.query.department.findMany({ columns: { id: true, name: true } }),
    tx.query.academicRecord.findMany({
      where: and(eq(academicRecord.studentId, input.studentId), eq(academicRecord.isVoid, false)),
    }),
  ]);
  const byKey = new Map(catalogue.map((c) => [courseCodeKey(c.code), c]));
  const deptById = new Map(departments.map((d) => [d.id, d]));

  const here = allRecords.filter((r) => r.semesterId === input.semesterId);
  const editable = new Map(here.filter((r) => r.origin === "IMPORTED").map((r) => [r.id, r]));
  const locked = here.filter((r) => r.origin !== "IMPORTED");

  const semBefore = await tx.query.studentSemesterSummary.findFirst({
    where: and(eq(studentSemesterSummary.studentId, stu.id), eq(studentSemesterSummary.semesterId, sem.id)),
  });
  const cumBefore = await tx.query.studentCumulativeSummary.findFirst({
    where: eq(studentCumulativeSummary.studentId, stu.id),
  });

  const problems: string[] = [];
  const toConfirm: string[] = [];
  const reason = input.reason.trim();

  // ---- row checks ------------------------------------------------------------
  if (input.rows.length > MAX_ROWS) problems.push(`A semester can hold at most ${MAX_ROWS} courses here.`);
  const seen = new Map<string, number>();
  const lockedKeys = new Set(locked.map((r) => courseCodeKey(r.courseCodeSnapshot)));
  const usedRecordIds = new Set<string>();

  interface Prepared {
    row: SemesterEditRow;
    key: string;
    shown: string;
    existing: (typeof here)[number] | null;
    listed: (typeof catalogue)[number] | undefined;
    letter: string;
    hours: number;
    scaleEntry: NonNullable<ReturnType<typeof scale.get>>;
    addToCatalogue: { title: string; departmentId: string } | null;
    title: string;
  }
  const prepared: Prepared[] = [];

  input.rows.forEach((row, i) => {
    const n = i + 1;
    const rowProblems: string[] = [];
    const key = courseCodeKey(row.code);
    const shown = row.code.trim() ? formatCourseCode(row.code.trim().toUpperCase()) : `Row ${n}`;
    if (!key) rowProblems.push(`Row ${n}: enter a course code.`);
    else if (!/^[a-z]+\d/.test(key)) rowProblems.push(`${shown} does not look like a course code (letters, then a number, like ACCT 101).`);
    if (key) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (seen.get(key)! > 1) rowProblems.push(`${shown} appears twice in this semester.`);
      if (lockedKeys.has(key)) rowProblems.push(`${shown} is already on record this semester from the system; it cannot be added here.`);
    }
    const h = row.creditHours;
    if (!Number.isFinite(h) || h <= 0) rowProblems.push(`${shown}: enter the credit hours.`);
    else if (Math.round(h * 10) !== h * 10 || h > 30) rowProblems.push(`${shown}: credit hours must be a number up to 30 with at most one decimal.`);
    const letter = row.letter.trim().toUpperCase();
    const scaleEntry = scale.get(letter);
    if (!scaleEntry) rowProblems.push(`${shown}: choose a grade.`);

    let existing: Prepared["existing"] = null;
    if (row.recordId) {
      existing = editable.get(row.recordId) ?? null;
      if (!existing) rowProblems.push(`${shown}: this grade was changed or removed elsewhere. Reload the page and try again.`);
      else if (usedRecordIds.has(row.recordId)) rowProblems.push(`${shown}: listed twice.`);
      usedRecordIds.add(row.recordId);
    }

    const listed = key ? byKey.get(key) : undefined;
    let addToCatalogue: Prepared["addToCatalogue"] = null;
    let title = listed?.title ?? "";
    if (!listed && key) {
      // An existing row keeps its code and title when only the grade changed.
      const keepsOldCourse = existing && courseCodeKey(existing.courseCodeSnapshot) === key && existing.courseId === null;
      const nc = row.newCourse;
      if (keepsOldCourse && !nc) {
        title = existing!.courseTitleSnapshot;
      } else if (!nc) {
        rowProblems.push(`${shown} is not in the catalogue. Add it to the catalogue, or record it as printed.`);
      } else if (nc.mode === "catalogue") {
        title = nc.title.trim();
        if (!title) rowProblems.push(`Give ${shown} its title to add it to the catalogue.`);
        if (!deptById.has(nc.departmentId)) rowProblems.push(`Choose the department ${shown} belongs to.`);
        if (Number.isFinite(h) && !Number.isInteger(h))
          rowProblems.push(`The catalogue holds whole credit hours only, so a ${fmt(h)}-hour course can't be added to it. Record it as printed instead.`);
        addToCatalogue = { title, departmentId: nc.departmentId };
      } else {
        title = nc.title.trim();
        if (!title) rowProblems.push(`Give ${shown} its title as printed.`);
      }
    }

    problems.push(...rowProblems);
    if (rowProblems.length === 0 && scaleEntry) {
      prepared.push({ row, key, shown, existing, listed, letter, hours: h, scaleEntry, addToCatalogue, title });
    }
  });

  if (problems.length === 0) {
    for (const p of prepared) {
      if (p.listed && p.hours !== p.listed.creditHours && (!p.existing || num(p.existing.creditHours) !== p.hours)) {
        toConfirm.push(`${p.shown}: ${fmt(p.hours)} credit hours entered; the catalogue lists ${p.listed.creditHours}.`);
      }
      const other = allRecords.find(
        (r) => r.semesterId !== input.semesterId && courseCodeKey(r.courseCodeSnapshot) === p.key,
      );
      const isNewToSemester = !p.existing || courseCodeKey(p.existing.courseCodeSnapshot) !== p.key;
      if (other && isNewToSemester) {
        toConfirm.push(`${p.shown} is also on this student's record in another semester; this one will count as a repeat attempt.`);
      }
    }
  }

  // ---- what changes ----------------------------------------------------------
  const keptIds = new Set(prepared.map((p) => p.existing?.id).filter(Boolean) as string[]);
  const changes: SemesterEditChange[] = [];
  const toVoid = [...editable.values()].filter((r) => !keptIds.has(r.id));
  const sameCodeAsExisting = (p: Prepared) => !!p.existing && courseCodeKey(p.existing.courseCodeSnapshot) === p.key;

  for (const r of toVoid) {
    changes.push({
      kind: "removed",
      code: formatCourseCode(r.courseCodeSnapshot),
      title: r.courseTitleSnapshot,
      before: { creditHours: r.creditHours, letter: r.letter },
      after: null,
      detail: "removed",
    });
  }
  // A row whose code was changed is a removal plus an addition.
  const replaced = prepared.filter((p) => p.existing && !sameCodeAsExisting(p));
  for (const p of replaced) {
    const r = p.existing!;
    changes.push({
      kind: "removed",
      code: formatCourseCode(r.courseCodeSnapshot),
      title: r.courseTitleSnapshot,
      before: { creditHours: r.creditHours, letter: r.letter },
      after: null,
      detail: `replaced by ${formatCourseCode(p.key.toUpperCase())}`,
    });
  }
  for (const p of prepared) {
    const code = formatCourseCode(p.addToCatalogue ? storedForm(p.row.code) : (p.listed?.code ?? storedForm(p.row.code)));
    if (!p.existing || !sameCodeAsExisting(p)) {
      changes.push({
        kind: "added",
        code,
        title: p.title,
        before: null,
        after: { creditHours: fmt(p.hours), letter: p.letter },
        detail: p.existing ? `replaces ${formatCourseCode(p.existing.courseCodeSnapshot)}` : "added",
      });
      continue;
    }
    const e = p.existing;
    const diffs: string[] = [];
    if (e.letter !== p.letter) diffs.push(`grade ${e.letter} → ${p.letter}`);
    if (num(e.creditHours) !== p.hours) diffs.push(`credit hours ${e.creditHours} → ${fmt(p.hours)}`);
    changes.push({
      kind: diffs.length ? "changed" : "unchanged",
      code: formatCourseCode(e.courseCodeSnapshot),
      title: e.courseTitleSnapshot,
      before: { creditHours: e.creditHours, letter: e.letter },
      after: { creditHours: fmt(p.hours), letter: p.letter },
      detail: diffs.join(", "),
    });
  }
  const real = changes.filter((c) => c.kind !== "unchanged");
  const unchanged = real.length === 0;
  const newCourses = prepared
    .filter((p) => p.addToCatalogue)
    .map((p) => `${formatCourseCode(storedForm(p.row.code))} ${p.title} (${fmt(p.hours)} hrs, ${deptById.get(p.addToCatalogue!.departmentId)?.name ?? "department"})`);

  if (!unchanged && reason.length < 3) problems.push("Give the reason for this change; it is kept in the audit log.");
  if (prepared.length === 0 && problems.length === 0 && here.length > 0 && editable.size > 0 && locked.length === 0) {
    toConfirm.push(`Every grade will be removed from ${label}. The semester will no longer appear on the transcript.`);
  }

  const baseCheck: SemesterEditCheck = {
    student: { id: stu.id, name: fullName(stu), studentNumber: stu.studentNumber },
    semester: { id: sem.id, label },
    changes,
    newCourses,
    locked: locked.map((r) => ({ code: formatCourseCode(r.courseCodeSnapshot), title: r.courseTitleSnapshot, letter: r.letter, creditHours: r.creditHours })),
    summary: {
      before: { semesterGpa: num(semBefore?.gpa), cgpa: num(cumBefore?.cgpa), credits: num(cumBefore?.totalCreditsEarned) ?? 0 },
      after: { semesterGpa: num(semBefore?.gpa), cgpa: num(cumBefore?.cgpa), credits: num(cumBefore?.totalCreditsEarned) ?? 0 },
    },
    problems,
    toConfirm,
    unchanged,
  };

  if (problems.length > 0 || unchanged) return { check: baseCheck, result: null };
  if (mode === "save" && toConfirm.length > 0 && !input.confirmed) {
    throw new ValidationError("Check the points listed and tick the box to confirm them.");
  }

  // ---- apply -----------------------------------------------------------------
  const requestId = randomUUID();
  const audit = (action: "ACADEMIC_RECORD_VOIDED" | "HISTORICAL_RECORD_CORRECTED" | "HISTORICAL_RECORD_ENTERED", entityId: string, oldValue: unknown, newValue: unknown) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      entityType: "academic_record",
      entityId,
      studentId: stu.id,
      oldValue: oldValue as Record<string, unknown> | undefined,
      newValue: newValue as Record<string, unknown> | undefined,
      reason,
      requestId,
    });

  // 1. Courses being added to the catalogue (once per code).
  const createdCourseCodes: string[] = [];
  const courseIdByKey = new Map<string, string>();
  for (const p of prepared) {
    if (!p.addToCatalogue) continue;
    if (courseIdByKey.has(p.key)) continue;
    const code = storedForm(p.row.code);
    const already = await tx.query.course.findFirst({ where: eq(course.code, code) });
    if (already) {
      courseIdByKey.set(p.key, already.id);
      continue;
    }
    const [row] = await tx
      .insert(course)
      .values({ departmentId: p.addToCatalogue.departmentId, code, title: p.title, creditHours: p.hours })
      .returning();
    courseIdByKey.set(p.key, row.id);
    createdCourseCodes.push(code);
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_CREATED",
      entityType: "course",
      entityId: row.id,
      newValue: { departmentId: p.addToCatalogue.departmentId, code, title: p.title, creditHours: p.hours },
      requestId,
    });
  }

  // 2. Removals: rows taken out, and rows whose course code was changed.
  const voidNow = [...toVoid, ...replaced.map((p) => p.existing!)];
  for (const r of voidNow) {
    await tx
      .update(academicRecord)
      .set({ isVoid: true, voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason })
      .where(eq(academicRecord.id, r.id));
    await audit("ACADEMIC_RECORD_VOIDED", r.id, { isVoid: false, courseCode: r.courseCodeSnapshot, letter: r.letter, creditHours: r.creditHours }, { isVoid: true });
  }
  const voidedIds = new Set(voidNow.map((r) => r.id));

  // 3. Edits in place.
  let changedCount = 0;
  for (const p of prepared) {
    if (!p.existing || !sameCodeAsExisting(p)) continue;
    const e = p.existing;
    if (e.letter === p.letter && num(e.creditHours) === p.hours) continue;
    await tx
      .update(academicRecord)
      .set({
        creditHours: String(p.hours),
        letter: p.letter,
        gradePoint: p.scaleEntry.gradePoint,
        countsInGpa: p.scaleEntry.countsInGpa,
        countsInAttempted: p.scaleEntry.countsInAttempted,
        countsInEarned: p.scaleEntry.countsInEarned,
      })
      .where(eq(academicRecord.id, e.id));
    changedCount++;
    await audit(
      "HISTORICAL_RECORD_CORRECTED",
      e.id,
      { creditHours: e.creditHours, letter: e.letter },
      { creditHours: String(p.hours), letter: p.letter },
    );
  }

  // 4. Additions, with the next attempt number for that course across the
  //    student's whole record (rows just voided no longer count).
  const attempts = new Map<string, number>();
  for (const r of allRecords) {
    if (voidedIds.has(r.id)) continue;
    const k = courseCodeKey(r.courseCodeSnapshot);
    attempts.set(k, Math.max(attempts.get(k) ?? 0, r.attemptNo));
  }
  let added = 0;
  for (const p of prepared) {
    if (p.existing && sameCodeAsExisting(p)) continue;
    const matched = p.listed ?? (courseIdByKey.has(p.key) ? { id: courseIdByKey.get(p.key)!, departmentId: p.addToCatalogue!.departmentId } : undefined);
    const attemptNo = (attempts.get(p.key) ?? 0) + 1;
    attempts.set(p.key, attemptNo);
    const snapshotCode = p.listed ? p.listed.code : storedForm(p.row.code);
    const [row] = await tx
      .insert(academicRecord)
      .values({
        studentId: stu.id,
        semesterId: sem.id,
        courseId: matched?.id ?? null,
        courseCodeSnapshot: snapshotCode,
        courseTitleSnapshot: p.title,
        creditHours: String(p.hours),
        letter: p.letter,
        gradePoint: p.scaleEntry.gradePoint,
        attemptNo,
        origin: "IMPORTED",
        countsInGpa: p.scaleEntry.countsInGpa,
        countsInAttempted: p.scaleEntry.countsInAttempted,
        countsInEarned: p.scaleEntry.countsInEarned,
        wasMajorAtRecord: matched ? matched.departmentId === stu.departmentId : false,
        enteredBy: actor.userId,
        sourceNote: "Entered in the past-grades semester editor.",
      })
      .returning();
    added++;
    await audit("HISTORICAL_RECORD_ENTERED", row.id, undefined, {
      courseCode: row.courseCodeSnapshot,
      creditHours: row.creditHours,
      letter: row.letter,
      attemptNo: row.attemptNo,
    });
  }

  await recomputeStudentSummaries(tx, stu.id);

  const semAfter = await tx.query.studentSemesterSummary.findFirst({
    where: and(eq(studentSemesterSummary.studentId, stu.id), eq(studentSemesterSummary.semesterId, sem.id)),
  });
  const cumAfter = await tx.query.studentCumulativeSummary.findFirst({
    where: eq(studentCumulativeSummary.studentId, stu.id),
  });
  baseCheck.summary.after = {
    semesterGpa: num(semAfter?.gpa),
    cgpa: num(cumAfter?.cgpa),
    credits: num(cumAfter?.totalCreditsEarned) ?? 0,
  };

  return {
    check: baseCheck,
    result: {
      semester: label,
      added,
      changed: changedCount,
      removed: voidNow.length,
      createdCourses: newCourses,
      createdCourseCodes,
    },
  };
}

/** What saving would do, and the GPA before and after. Writes nothing. */
export async function checkSemesterEdit(actor: Actor, input: SemesterEditInput): Promise<SemesterEditCheck> {
  await assertCan(actor, "historical.correctRecord");
  await assertCan(actor, "historical.enterRecord");
  await assertCan(actor, "historical.voidRecord");
  try {
    return await db.transaction(async (tx) => {
      const { check } = await run(tx, actor, input, "check");
      throw new DryRun(check);
    });
  } catch (err) {
    if (err instanceof DryRun) return err.check;
    throw err;
  }
}

/** Saves the whole semester edit, or nothing. */
export async function saveSemesterEdit(actor: Actor, input: SemesterEditInput): Promise<SemesterEditResult> {
  await assertCan(actor, "historical.correctRecord");
  await assertCan(actor, "historical.enterRecord");
  await assertCan(actor, "historical.voidRecord");
  return db.transaction(async (tx) => {
    const { check, result } = await run(tx, actor, input, "save");
    if (check.problems.length) throw new ValidationError(check.problems[0]);
    if (!result) throw new ValidationError("There is nothing to save: no grade was changed.");
    return result;
  });
}
