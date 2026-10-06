import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { academicRecord, academicYear, semester } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/students/name";
import { genderLabel } from "@/lib/students/gender";
import { formatCourseCode } from "@/lib/courses/courseCode";
import { semesterDisplayName } from "@/lib/academic/semesterName";
import { getCumulativeSummary, getSemesterSummaries } from "@/lib/gpa/gpa";
import { DEFAULT_GPA_POLICY, roundHalfUp } from "@/lib/gpa/engine";
import { getGradeSheetSignatories } from "@/lib/settings/signatories";
import { formatDay } from "./formatDay";
import { titleCase } from "./titleCase";

/**
 * Everything the printed Academic Transcript needs, assembled once.
 *
 * The transcript's sibling is the one-semester grade sheet
 * (src/lib/gradesheet/gradeSheet.ts), and it follows the same rules: a
 * read-only, RLS-scoped read through asUser() -- a student can only ever
 * assemble their own, staff any student's -- and plain, pre-formatted data
 * out, so the document component does no arithmetic and prints exactly
 * what was computed here. GPAs and credit totals are the GPA engine's own
 * stored figures, not a second calculation that could disagree with them.
 */

export interface TranscriptField {
  label: string;
  value: string;
}

export interface TranscriptCourse {
  code: string;
  title: string;
  creditHours: string;
  /** The letter, with "(R)" after an attempt a later repeat replaced. */
  grade: string;
  /** Grade point x credit hours, 2dp; null when it counts for nothing. */
  points: string | null;
}

export interface TranscriptSemester {
  id: string;
  academicYearId: string;
  /** "2020/2021 — Semester I" */
  label: string;
  courses: TranscriptCourse[];
  totalCredits: string;
  totalPoints: string;
  /** The engine's semester GPA, or null when nothing in it counts. */
  gpa: string | null;
}

export interface TranscriptScaleRow {
  letter: string;
  range: string;
  gradePoint: string;
}

export interface TranscriptData {
  student: {
    id: string;
    name: string;
    studentNumber: string;
    major: string;
  };
  personal: TranscriptField[];
  academic: TranscriptField[];
  admission: TranscriptField[];
  /** In academic order, oldest first. */
  semesters: TranscriptSemester[];
  summary: {
    cgpa: string | null;
    creditsAttempted: string;
    creditsEarned: string;
    graduationCreditHours: number;
    totalAccumulatedPoints: string;
    /** "Good standing", "Honours", "Probation", or null while unknown. */
    standing: string | null;
  };
  gradingScale: TranscriptScaleRow[];
  /** One-line explanations of the marks that are not on the scale. */
  gradingNotes: { mark: string; meaning: string }[];
  /** Who certifies it -- the same configurable title the grade sheet prints. */
  signatoryTitle: string;
  /** "Oct 6, 2026" */
  issuedOn: string;
  /** True while the student's past records are still being entered. */
  isProvisional: boolean;
}

/** What a field with nothing recorded prints as. */
export const NOT_RECORDED = "-";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

/**
 * The College is in Monrovia, so a date printed on its documents is the
 * date there -- not the server's, which is UTC on Vercel and could be
 * either side of midnight from the office.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Monrovia",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A stored date, formatted, or null when none is recorded. */
function day(value: string | null): string | null {
  return value ? formatDay(value) : null;
}

/** A free-text value, capitalised, or the dash for "not recorded". */
function text(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? titleCase(trimmed) : NOT_RECORDED;
}

function formatRange(minScore: number | null, maxScore: number | null): string {
  if (minScore === null || maxScore === null) return "—";
  return `${minScore}-${maxScore}`;
}

export async function getTranscript(actor: Actor, studentId: string): Promise<TranscriptData> {
  const [rows, summaries, cumulative, signatories] = await Promise.all([
    asUser(actor.userId, async (tx) => {
      const studentRow = await tx.query.student.findFirst({ where: (s, { eq: eqOp }) => eqOp(s.id, studentId) });
      if (!studentRow) throw new NotFoundError("Student not found.");

      const [department, records, scaleRows] = await Promise.all([
        tx.query.department.findFirst({ where: (d, { eq: eqOp }) => eqOp(d.id, studentRow.departmentId) }),
        tx.query.academicRecord.findMany({
          where: and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false)),
          orderBy: (t, { asc }) => asc(t.courseCodeSnapshot),
        }),
        tx.query.gradeScale.findMany({ orderBy: (t, { asc }) => [asc(t.policyVersion), asc(t.displayOrder)] }),
      ]);

      const semesterIds = [...new Set(records.map((r) => r.semesterId))];
      const semesterRows = semesterIds.length
        ? await tx.select().from(semester).where(inArray(semester.id, semesterIds))
        : [];
      const yearIds = [...new Set(semesterRows.map((s) => s.academicYearId))];
      const [yearRows, college] = await Promise.all([
        yearIds.length ? tx.select().from(academicYear).where(inArray(academicYear.id, yearIds)) : Promise.resolve([]),
        department
          ? tx.query.college.findFirst({ where: (c, { eq: eqOp }) => eqOp(c.id, department.collegeId) })
          : Promise.resolve(undefined),
      ]);

      return { studentRow, department, college, records, scaleRows, semesterRows, yearRows };
    }),
    getSemesterSummaries(actor, studentId),
    getCumulativeSummary(actor, studentId),
    getGradeSheetSignatories(),
  ]);

  const { studentRow, department, college, records, scaleRows, semesterRows, yearRows } = rows;

  // Academic order: by the year's start date, then Semester I before II.
  const yearById = new Map(yearRows.map((y) => [y.id, y]));
  const orderedSemesters = [...semesterRows].sort((a, b) => {
    const ya = yearById.get(a.academicYearId)?.startDate ?? "";
    const yb = yearById.get(b.academicYearId)?.startDate ?? "";
    return ya < yb ? -1 : ya > yb ? 1 : a.sequence - b.sequence;
  });

  // Exact decimal arithmetic, as on the grade sheet -- a transcript is the
  // last place a floating-point artefact belongs.
  let totalAccumulatedPoints = new Decimal(0);
  const semesters: TranscriptSemester[] = orderedSemesters.map((sem) => {
    let semesterPoints = new Decimal(0);
    const courses = records
      .filter((r) => r.semesterId === sem.id)
      .map((r): TranscriptCourse => {
        // Points are printed only for a grade that counts: an attempt a
        // later repeat replaced, an Incomplete or a No Grade shows a dash,
        // so the column adds up to the total printed under it.
        const counts = r.countsInGpa && !r.isRepeatDropped && r.gradePoint !== null;
        const points = counts ? new Decimal(r.gradePoint!).times(r.creditHours) : null;
        if (points) semesterPoints = semesterPoints.plus(points);
        return {
          code: formatCourseCode(r.courseCodeSnapshot),
          title: r.courseTitleSnapshot,
          creditHours: new Decimal(r.creditHours).toString(),
          grade: r.isRepeatDropped ? `${r.letter} (R)` : r.letter,
          points: points ? roundHalfUp(points, 2) : null,
        };
      });
    totalAccumulatedPoints = totalAccumulatedPoints.plus(semesterPoints);
    const summary = summaries.find((s) => s.semesterId === sem.id);
    const year = yearById.get(sem.academicYearId);
    return {
      id: sem.id,
      academicYearId: sem.academicYearId,
      label: `${year?.label ?? "—"} — ${semesterDisplayName(sem)}`,
      courses,
      totalCredits: summary ? new Decimal(summary.creditsAttempted).toString() : "0",
      totalPoints: semesterPoints.toFixed(2),
      gpa: summary?.gpa ?? null,
    };
  });

  // The scale in effect today, as on the grade sheet. The older plain
  // letters and No Grade are explained in the notes line instead, and only
  // when this record actually carries one.
  const now = new Date();
  const inEffect = scaleRows.filter((r) => new Date(r.effectiveFrom) <= now);
  const activeVersion = inEffect.length ? Math.max(...inEffect.map((r) => r.policyVersion)) : 0;
  const active = scaleRows.filter((r) => r.policyVersion === activeVersion);
  const letters = new Set(records.map((r) => r.letter));
  const legacy = active.filter((r) => r.isLegacy && letters.has(r.letter));

  const gradingNotes: { mark: string; meaning: string }[] = [];
  if (legacy.length) {
    gradingNotes.push({
      mark: legacy.map((r) => r.letter).join(", "),
      meaning: `Older plain letters on past records (${legacy.map((r) => (r.gradePoint === null ? "—" : new Decimal(r.gradePoint).toString())).join(", ")})`,
    });
  }
  gradingNotes.push({ mark: "I", meaning: "Incomplete" });
  if (letters.has("NG")) gradingNotes.push({ mark: "NG", meaning: "No Grade: not counted; settled within two semesters" });
  if (records.some((r) => r.isRepeatDropped)) {
    gradingNotes.push({ mark: "R", meaning: "Repeated in a later semester; not counted" });
  }

  const major = department?.name ?? NOT_RECORDED;
  const enrolledOn = day(studentRow.enrolmentDate) ?? String(studentRow.enrolmentYear);

  return {
    student: {
      id: studentRow.id,
      name: fullName(studentRow),
      studentNumber: studentRow.studentNumber,
      major: text(major),
    },
    personal: [
      { label: "Sex", value: studentRow.gender ? genderLabel(studentRow.gender) : NOT_RECORDED },
      { label: "Date of Birth", value: day(studentRow.dateOfBirth) ?? NOT_RECORDED },
      { label: "Country of Origin", value: text(studentRow.countryOfOrigin) },
      { label: "County of Origin", value: text(studentRow.countyOfOrigin) },
      { label: "Parent or Guardian", value: text(studentRow.parentGuardian) },
      { label: "Address", value: text(studentRow.address) },
    ],
    academic: [
      { label: "Major Field of Study", value: text(major) },
      { label: "Minor Field of Study", value: text(studentRow.minor) },
      { label: "College of Discipline", value: text(college?.name) },
      // As entered: "BSc" and "BA" are abbreviations with their own casing.
      { label: "Degree Acquired", value: studentRow.degree?.trim() || NOT_RECORDED },
      { label: "Date of Graduation", value: day(studentRow.graduationDate) ?? NOT_RECORDED },
      { label: "Distinction", value: text(studentRow.distinction) },
    ],
    admission: [
      { label: "ID Number", value: studentRow.studentNumber },
      { label: "Enrollment Status", value: text(studentRow.enrollmentStatus) },
      { label: "Date of Enrollment", value: enrolledOn },
      { label: "Accepted From", value: text(studentRow.acceptedFrom) },
    ],
    semesters,
    summary: {
      cgpa: cumulative?.cgpa ?? null,
      creditsAttempted: cumulative ? new Decimal(cumulative.totalCreditsAttempted).toString() : "0",
      creditsEarned: cumulative ? new Decimal(cumulative.totalCreditsEarned).toString() : "0",
      graduationCreditHours: cumulative?.graduationCreditHours ?? DEFAULT_GPA_POLICY.graduationCreditHours,
      totalAccumulatedPoints: totalAccumulatedPoints.toFixed(2),
      standing: cumulative?.standing ? (STANDING_LABEL[cumulative.standing] ?? cumulative.standing) : null,
    },
    gradingScale: active
      .filter((r) => !r.isLegacy && r.gradePoint !== null && r.minScore !== null)
      .map((r) => ({
        letter: r.letter,
        range: formatRange(r.minScore, r.maxScore),
        gradePoint: roundHalfUp(r.gradePoint!, 2),
      })),
    gradingNotes,
    signatoryTitle: signatories.signedTitle,
    issuedOn: DATE_FORMAT.format(now),
    isProvisional: cumulative?.isProvisional ?? studentRow.historicalImportStatus !== "COMPLETE",
  };
}
