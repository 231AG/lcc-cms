import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { academicRecord, semester } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/students/name";
import { semesterDisplayName, semesterNumeral } from "@/lib/academic/semesterName";
import { getCumulativeSummary, getSemesterSummaries } from "@/lib/gpa/gpa";
import { roundHalfUp } from "@/lib/gpa/engine";
import { getGradeSheetSignatories, type GradeSheetSignatories } from "@/lib/settings/signatories";

/**
 * Everything one printed Student Grade Sheet needs, assembled once.
 *
 * Read-only and RLS-scoped through asUser() rather than assertCan-gated,
 * the same pattern as every other academic read in this codebase
 * (src/lib/gpa/gpa.ts): a student's own figures are theirs to see, and
 * staff see any student's. Nothing here can write.
 *
 * The returned object is plain, serialisable data with every figure already
 * formatted as a string. That is deliberate: the document component is then
 * pure presentation with no Decimal, no database and no formatting rules of
 * its own, so what gets printed is exactly what this function computed.
 */

export interface GradeSheetCourseRow {
  title: string;
  code: string;
  creditHours: string;
  letter: string;
  /** 2dp, or null for a grade that carries no grade point (Incomplete). */
  gradePoint: string | null;
  /** grade point x credit hours, 2dp; null when there is no grade point. */
  gradePoints: string | null;
  /** An earlier attempt, excluded from the CGPA but still on the record. */
  isRepeatDropped: boolean;
}

export interface GradeSheetScaleRow {
  letter: string;
  range: string;
  gradePoint: string;
  description: string;
}

export interface GradeSheetData {
  student: {
    name: string;
    studentNumber: string;
    status: string;
    college: string;
    major: string;
    minor: string;
  };
  academicYearLabel: string;
  semesterName: string;
  /** "I" or "II" -- the sheet's own way of naming the semester. */
  semesterNumeral: string;
  courses: GradeSheetCourseRow[];
  summary: {
    totalCredits: string;
    creditsEarned: string;
    totalGradePoints: string;
    /** 3dp, or null when the semester has no gradeable credits at all. */
    gpa: string | null;
  };
  standing: {
    /** "HONOURS" / "GOOD STANDING" / "PROBATION", or null when unavailable. */
    label: string | null;
    note: string;
  };
  gradingScale: GradeSheetScaleRow[];
  signatories: GradeSheetSignatories;
  /** True while the student's historical record is still being entered. */
  isProvisional: boolean;
}

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "HONOURS",
  GOOD_STANDING: "GOOD STANDING",
  PROBATION: "PROBATION",
};

/**
 * The one-word verdict beside each grade band.
 *
 * The `grade_scale` table stores bands and grade points, not adjectives --
 * so rather than invent a column, the word is derived from the letter's
 * family, which is the only thing it can honestly depend on. The words
 * themselves are the College's own, taken from its printed grade sheet.
 */
function describeLetter(letter: string): string {
  switch (letter.charAt(0)) {
    case "A":
      return "Excellent";
    case "B":
      return "Very Good";
    case "C":
      return "Good";
    case "D":
      return "Poor";
    case "F":
      return "Failure";
    default:
      return "Incomplete";
  }
}

function formatRange(minScore: number | null, maxScore: number | null): string {
  if (minScore === null && maxScore === null) return "—";
  if (minScore === null) return `Below ${(maxScore ?? 0) + 1}`;
  if (maxScore === null) return `${minScore} and above`;
  return `${minScore} – ${maxScore}`;
}

export async function getGradeSheet(actor: Actor, studentId: string, semesterId: string): Promise<GradeSheetData> {
  // One transaction for the row reads that share a connection, then the two
  // GPA reads and the settings read alongside it -- they touch different
  // tables and nothing here depends on anything else here.
  const [rows, summaries, cumulative, signatories] = await Promise.all([
    asUser(actor.userId, async (tx) => {
      const [studentRow, semesterRow, scaleRows] = await Promise.all([
        tx.query.student.findFirst({ where: (s, { eq: eqOp }) => eqOp(s.id, studentId) }),
        tx.query.semester.findFirst({ where: eq(semester.id, semesterId) }),
        tx.query.gradeScale.findMany({ orderBy: (t, { asc }) => [asc(t.policyVersion), asc(t.displayOrder)] }),
      ]);
      if (!studentRow) throw new NotFoundError("Student not found.");
      if (!semesterRow) throw new NotFoundError("Semester not found.");

      const [department, records] = await Promise.all([
        tx.query.department.findFirst({ where: (d, { eq: eqOp }) => eqOp(d.id, studentRow.departmentId) }),
        tx.query.academicRecord.findMany({
          where: and(
            eq(academicRecord.studentId, studentId),
            eq(academicRecord.semesterId, semesterId),
            eq(academicRecord.isVoid, false),
          ),
          orderBy: (t, { asc }) => asc(t.courseCodeSnapshot),
        }),
      ]);

      const [college, academicYear] = await Promise.all([
        department
          ? tx.query.college.findFirst({ where: (c, { eq: eqOp }) => eqOp(c.id, department.collegeId) })
          : Promise.resolve(undefined),
        tx.query.academicYear.findFirst({ where: (y, { eq: eqOp }) => eqOp(y.id, semesterRow.academicYearId) }),
      ]);

      return { studentRow, semesterRow, scaleRows, department, college, academicYear, records };
    }),
    getSemesterSummaries(actor, studentId),
    getCumulativeSummary(actor, studentId),
    getGradeSheetSignatories(),
  ]);

  const { studentRow, semesterRow, scaleRows, department, college, academicYear, records } = rows;

  // Only the policy version actually in effect appears on the sheet -- a
  // superseded scale would be printing rules this student was never graded
  // under (grade_scale is versioned for exactly that reason).
  const now = new Date();
  const inEffect = scaleRows.filter((r) => new Date(r.effectiveFrom) <= now);
  const activeVersion = inEffect.length ? Math.max(...inEffect.map((r) => r.policyVersion)) : 0;

  // Every figure below is exact decimal arithmetic (DER-08/TEC-09) -- a
  // printed transcript is the last place a floating-point artefact belongs.
  let totalGradePoints = new Decimal(0);
  const courses: GradeSheetCourseRow[] = records.map((r) => {
    const points = r.gradePoint === null ? null : new Decimal(r.gradePoint).times(r.creditHours);
    if (points && r.countsInGpa) totalGradePoints = totalGradePoints.plus(points);
    return {
      title: r.courseTitleSnapshot,
      code: r.courseCodeSnapshot,
      creditHours: new Decimal(r.creditHours).toFixed(0),
      letter: r.letter,
      gradePoint: r.gradePoint === null ? null : roundHalfUp(r.gradePoint, 2),
      gradePoints: points === null ? null : roundHalfUp(points, 2),
      isRepeatDropped: r.isRepeatDropped,
    };
  });

  const summary = summaries.find((s) => s.semesterId === semesterId);
  const isProvisional = summary?.isProvisional ?? studentRow.historicalImportStatus !== "COMPLETE";

  return {
    student: {
      name: fullName(studentRow).toUpperCase(),
      studentNumber: studentRow.studentNumber,
      status: studentRow.status,
      college: college ? college.name : "—",
      // The system has no separate "major" field: a student belongs to a
      // department, and that department IS their programme of study.
      major: department ? department.name : "—",
      // ...and it has no minor at all. Printed as N/A rather than left
      // blank, so the sheet says "not applicable" instead of looking
      // like a field somebody forgot to fill in.
      minor: "N/A",
    },
    academicYearLabel: academicYear?.label ?? "—",
    semesterName: semesterDisplayName(semesterRow),
    semesterNumeral: semesterNumeral(semesterRow),
    courses,
    summary: {
      totalCredits: summary ? new Decimal(summary.creditsAttempted).toFixed(2) : "0.00",
      creditsEarned: summary ? new Decimal(summary.creditsEarned).toFixed(2) : "0.00",
      totalGradePoints: totalGradePoints.toFixed(2),
      gpa: summary ? summary.gpa : null,
    },
    standing: {
      // Standing is a cumulative figure, not a per-semester one, and
      // GRADING_RULES.md §8 is explicit that it is shown as genuinely
      // absent -- not as "Unknown" -- while a record is still incomplete.
      label: cumulative?.standing ? (STANDING_LABEL[cumulative.standing] ?? cumulative.standing) : null,
      note: cumulative?.standing
        ? `Cumulative GPA ${cumulative.cgpa ?? "—"}`
        : "Not available until this student's record is complete.",
    },
    gradingScale: scaleRows
      .filter((r) => r.policyVersion === activeVersion)
      .map((r) => ({
        letter: r.letter,
        range: formatRange(r.minScore, r.maxScore),
        gradePoint: r.gradePoint === null ? "—" : roundHalfUp(r.gradePoint, 2),
        description: describeLetter(r.letter),
      })),
    signatories,
    isProvisional,
  };
}

/**
 * The semesters this student actually has results in -- the list the
 * profile page turns into one "Grade sheet" link per semester. Derived
 * from academic_record so a semester with nothing in it never offers a
 * sheet that would print empty.
 */
export async function getSemestersWithResults(actor: Actor, studentId: string): Promise<string[]> {
  const rows = await asUser(actor.userId, (tx) =>
    tx
      .selectDistinct({ semesterId: academicRecord.semesterId })
      .from(academicRecord)
      .where(and(eq(academicRecord.studentId, studentId), eq(academicRecord.isVoid, false))),
  );
  return rows.map((r) => r.semesterId);
}
