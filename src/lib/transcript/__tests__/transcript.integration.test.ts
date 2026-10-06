import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicRecord,
  academicYear,
  college as collegeTable,
  department as departmentTable,
  semester,
  student,
  studentSemesterSummary,
  studentCumulativeSummary,
} from "@/lib/db/schema";
import { saveManualEntry, type ManualEntryRow } from "@/lib/historical/manualEntry";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { getTranscript, NOT_RECORDED } from "../transcript";

/**
 * The transcript's figures: every semester in academic order, an attempt a
 * later repeat replaced marked (R) and left out of the points, totals that
 * add up, the information boxes capitalised (the degree as entered), dashes
 * for what was never recorded -- and a student who cannot read anyone's
 * transcript but their own.
 *
 * Records go in through saveManualEntry, the audited path the office uses,
 * so the GPA summaries are the engine's own.
 */

const id = () => randomUUID();
const ADMIN = id(), STU = id(), OTHER = id();
const COLLEGE = id(), DEPT = id(), YEAR_A = id(), YEAR_B = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const Y0 = 1900 + ((Date.now() + 53) % 80);
const LABEL_A = `${Y0}/${Y0 + 1}`;
const LABEL_B = `${Y0 + 1}/${Y0 + 2}`;
const STUDENT_NO = `${Y0}${String(Date.now() % 1000).padStart(3, "0")}`;
const OTHER_NO = `${Y0}${String((Date.now() + 1) % 1000).padStart(3, "0")}9`;
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;
const self = { userId: STU, role: "STUDENT", displayName: "s", mustChangePassword: false } as unknown as Actor;
const other = { userId: OTHER, role: "STUDENT", displayName: "o", mustChangePassword: false } as unknown as Actor;

const row = (letter0: string, title: string, creditHours: number, letter: string): ManualEntryRow => ({
  code: `${letter0}${tag}101`,
  creditHours,
  letter,
  newCourse: { mode: "asPrinted", title },
});

describe("academic transcript", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `tr-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Grace", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: OTHER, loginIdentifier: OTHER_NO, displayName: "Other", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `TR-${tag}`, name: "college of liberal arts", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `TRD${tag}`, name: "criminal justice", isActive: true });
    await db.insert(student).values([
      {
        id: STU, studentNumber: STUDENT_NO, firstName: "Grace", middleName: "Tenneh", lastName: `Kollie${tag}`, gender: "FEMALE",
        departmentId: DEPT, enrolmentYear: Y0, createdBy: ADMIN,
        dateOfBirth: "2001-03-14", countyOfOrigin: "grand cape mount", parentGuardian: "moses kollie",
        address: "sinkor, monrovia", degree: "BSc",
      },
      { id: OTHER, studentNumber: OTHER_NO, firstName: "Other", lastName: `Student${tag}`, departmentId: DEPT, enrolmentYear: Y0, createdBy: ADMIN },
    ]);
    await db.insert(academicYear).values([
      { id: YEAR_A, label: LABEL_A, startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-07-31`, isCurrent: false },
      { id: YEAR_B, label: LABEL_B, startDate: `${Y0 + 1}-09-01`, endDate: `${Y0 + 2}-07-31`, isCurrent: false },
    ]);
    await db.insert(semester).values([
      { academicYearId: YEAR_A, sequence: 1, name: "Semester I", state: "CLOSED", startDate: `${Y0}-09-01`, endDate: `${Y0 + 1}-01-20` },
      { academicYearId: YEAR_A, sequence: 2, name: "Semester II", state: "CLOSED", startDate: `${Y0 + 1}-02-01`, endDate: `${Y0 + 1}-07-20` },
      { academicYearId: YEAR_B, sequence: 1, name: "Semester I", state: "CLOSED", startDate: `${Y0 + 1}-09-01`, endDate: `${Y0 + 2}-01-20` },
    ]);

    // Entered out of order on purpose: the transcript sorts, not the entry.
    await saveManualEntry(admin, {
      studentId: STU, yearLabel: LABEL_B, sequence: 1, confirmed: true,
      rows: [row("C", "Intro to Criminology", 3, "B+"), row("E", "Sophomore English I", 3, "A-")],
    });
    await saveManualEntry(admin, {
      studentId: STU, yearLabel: LABEL_A, sequence: 1, confirmed: true,
      rows: [row("M", "College Mathematics I", 3, "A"), row("P", "Critical Thinking", 2, "B")],
    });
    // CJUS taken first here with a D, then repeated in the next year above.
    await saveManualEntry(admin, {
      studentId: STU, yearLabel: LABEL_A, sequence: 2, confirmed: true,
      rows: [row("C", "Intro to Criminology", 3, "D"), row("S", "Sociology of Religion", 3, "C+")],
    });
  });

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, STU)));
    await quiet(db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, STU)));
    await quiet(db.delete(academicRecord).where(eq(academicRecord.studentId, STU)));
    await quiet(db.delete(semester).where(inArray(semester.academicYearId, [YEAR_A, YEAR_B])));
    await quiet(db.delete(academicYear).where(inArray(academicYear.id, [YEAR_A, YEAR_B])));
    // The students, department, college and users stay: audit rows hold
    // RESTRICT keys to them. Harmless synthetic rows.
  });

  it("lists every semester in academic order with its own totals", async () => {
    const t = await getTranscript(admin, STU);
    expect(t.semesters.map((s) => s.label)).toEqual([
      `${LABEL_A} — Semester I`,
      `${LABEL_A} — Semester II`,
      `${LABEL_B} — Semester I`,
    ]);
    const [first] = t.semesters;
    expect(first.courses.map((c) => [c.title, c.creditHours, c.grade, c.points])).toEqual([
      ["College Mathematics I", "3", "A", "12.00"],
      ["Critical Thinking", "2", "B", "6.00"],
    ]);
    expect(first).toMatchObject({ totalCredits: "5", totalPoints: "18.00", gpa: "3.600" });
  });

  it("marks an attempt a later repeat replaced, and leaves it out of the points", async () => {
    const t = await getTranscript(admin, STU);
    const repeated = t.semesters[1].courses.find((c) => c.title === "Intro to Criminology");
    expect(repeated).toMatchObject({ grade: "D (R)", points: null });
    expect(t.semesters[1].totalPoints).toBe("6.90");
    expect(t.gradingNotes.map((n) => n.mark)).toEqual(expect.arrayContaining(["A, B, D", "I", "R"]));
    // 18 + 6.90 + (9.90 + 11.10): the replaced D adds nothing.
    expect(t.summary.totalAccumulatedPoints).toBe("45.90");
  });

  it("capitalises the information boxes, keeps the degree as entered, and dashes what is missing", async () => {
    const t = await getTranscript(admin, STU);
    const value = (fields: { label: string; value: string }[], label: string) => fields.find((f) => f.label === label)?.value;
    expect(t.student.major).toBe("Criminal Justice");
    expect(value(t.personal, "Sex")).toBe("Female");
    expect(value(t.personal, "Date of Birth")).toBe("Mar 14, 2001");
    expect(value(t.personal, "County of Origin")).toBe("Grand Cape Mount");
    expect(value(t.personal, "Parent or Guardian")).toBe("Moses Kollie");
    expect(value(t.personal, "Country of Origin")).toBe(NOT_RECORDED);
    expect(value(t.academic, "College of Discipline")).toBe("College of Liberal Arts");
    expect(value(t.academic, "Degree Acquired")).toBe("BSc");
    expect(value(t.admission, "Date of Enrollment")).toBe(String(Y0));
  });

  it("lets a student read their own transcript and no one else's", async () => {
    await expect(getTranscript(self, STU)).resolves.toMatchObject({ student: { studentNumber: STUDENT_NO } });
    await expect(getTranscript(other, STU)).rejects.toBeInstanceOf(NotFoundError);
  });
});
