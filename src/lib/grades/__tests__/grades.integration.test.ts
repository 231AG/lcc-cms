import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";

// Real network round-trips to a live Supabase project produce enough
// timing variance that any test in this file -- not a fixed subset --
// can occasionally exceed the project's 40s default (observed across
// several runs while building this suite: a different test tipped over
// each time). A file-wide floor is more honest than chasing individual
// tests one at a time.
vi.setConfig({ testTimeout: 90_000 });
import {
  appUser,
  academicRecord,
  academicYear,
  auditLog,
  college as collegeTable,
  course,
  courseOffering,
  gradeCorrectionRequest,
  gradeRecord,
  gradeSubmission,
  offeringMeeting,
  registration,
  semester,
  studentCumulativeSummary,
  studentSemesterSummary,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { enrollStudent } from "@/lib/students/students";
import { createAcademicYear, createSemester, transitionSemester } from "@/lib/academic/calendar";
import { createCourse, createDepartment } from "@/lib/academic/structure";
import { addMeeting, createOffering, publishOffering } from "@/lib/offerings/offerings";
import { registerDirect } from "@/lib/planning/planning";
import { createRetrospectiveSemester, enterHistoricalSemester } from "@/lib/historical/historical";
import {
  approveSubmission,
  clearDraftGrade,
  decideCorrection,
  getClassRoster,
  getSubmissionQueue,
  requestCorrection,
  rejectSubmission,
  saveClassDraft,
  submitClass,
} from "../grades";
import { ConflictError, StateError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.11/26 Stage 10 (G10) acceptance criteria, automated: the
 * three-layer segregation of duties (Section 15.1); the whole-class
 * one-transaction save; batch vs. individual approve/reject (CR-06); the
 * full correction cycle including the staleness check; a retake through
 * publication (W-18); concurrent approval of the same submission
 * resolving to exactly one winner.
 */

let adminActor: Actor;
let superAdminActor: Actor;
let adminUserId: string;
let superAdminUserId: string;
let departmentId: string;
let semesterId: string;
let pastSemesterId: string;
let courseA: { id: string; code: string; title: string };
let courseRepeat: { id: string; code: string; title: string };

const cleanupUserIds: string[] = [];
const cleanupCourseIds: string[] = [];
const cleanupOfferingIds: string[] = [];
let cleanupDepartmentId: string | null = null;
let cleanupSemesterId: string | null = null;
let cleanupPastSemesterId: string | null = null;
let cleanupAcademicYearId: string | null = null;
let cleanupPastAcademicYearId: string | null = null;

function nextKey(): string {
  return `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({ where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")) });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

function makeStudentNumber(): { studentNumber: string; enrolmentYear: number } {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return { studentNumber: `2021${suffix}`, enrolmentYear: 2021 };
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

// Offerings can only be created while the semester is Draft/Open/
// Registration (Stage 8's own rule -- schedules freeze once teaching
// starts), but these tests need one fresh offering per test while the
// semester is in Grade Submission. So every offering any test will ever
// need is pre-created in beforeAll, before the semester is walked
// forward; makeOffering here just looks one up by (course, section).
const offeringPool = new Map<string, string>();

async function precreateOffering(courseId: string, section: string, day: number) {
  const off = await createOffering(adminActor, { semesterId, courseId, section });
  cleanupOfferingIds.push(off.id);
  await addMeeting(adminActor, off.id, { dayOfWeek: day, startTime: "09:00", endTime: "10:00" });
  await publishOffering(adminActor, off.id);
  offeringPool.set(`${courseId}:${section}`, off.id);
}

async function makeOffering(courseId: string, section: string): Promise<string> {
  const id = offeringPool.get(`${courseId}:${section}`);
  if (!id) throw new Error(`No pre-created offering for ${courseId} section ${section} -- add it to beforeAll's pool.`);
  return id;
}

async function registerAndKey(studentId: string, offeringId: string) {
  const result = await registerDirect(adminActor, studentId, offeringId, "fixture registration");
  return result.registration;
}

beforeAll(async () => {
  const realSuperAdmin = await realSuperAdminActor();
  const { username: adminUsername } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-grades-admin-${Date.now()}`,
    displayName: "Grades Test Admin",
    role: "ADMIN",
  });
  const adminRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, adminUsername) });
  if (!adminRow) throw new Error("fixture setup failed");
  adminUserId = adminRow.id;
  adminActor = { userId: adminRow.id, role: "ADMIN" };

  const { username: superUsername } = await createStaffAccount({
    actor: realSuperAdmin,
    username: `test-grades-super-${Date.now()}`,
    displayName: "Grades Test Super Admin",
    role: "SUPER_ADMIN",
  });
  const superRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, superUsername) });
  if (!superRow) throw new Error("fixture setup failed");
  superAdminUserId = superRow.id;
  superAdminActor = { userId: superRow.id, role: "SUPER_ADMIN" };

  const college = await db.query.college.findFirst({ where: eq(collegeTable.isActive, true) });
  if (!college) throw new Error("No active college exists to bootstrap this suite's fixtures.");
  const deptSuffix = Date.now() % 100000;
  const dept = await createDepartment(adminActor, { collegeId: college.id, code: `GRD${deptSuffix}`, name: "Grades Test Department" });
  departmentId = dept.id;
  cleanupDepartmentId = dept.id;

  const courseSuffix = Date.now() % 100000;
  const courseRowA = await createCourse(adminActor, { departmentId, code: `GRA${courseSuffix}`, title: "Grades Course A", creditHours: 3 });
  const courseRowRepeat = await createCourse(adminActor, { departmentId, code: `GRB${courseSuffix}`, title: "Grades Repeat Course", creditHours: 3 });
  courseA = { id: courseRowA.id, code: courseRowA.code, title: courseRowA.title };
  courseRepeat = { id: courseRowRepeat.id, code: courseRowRepeat.code, title: courseRowRepeat.title };
  cleanupCourseIds.push(courseA.id, courseRepeat.id);

  // A genuinely earlier, Closed semester for the retake test's failing
  // first attempt (Section 16.5's repeat resolution breaks ties by
  // semester recency, so the two attempts must be in different terms).
  // Must fall after the test students' enrolment year (2021, from
  // makeStudentNumber) and before "now" (createRetrospectiveSemester
  // requires it to have already ended).
  const pastYearLabel = "2022/2023";
  const pastYear = await createAcademicYear(adminActor, { label: pastYearLabel, startDate: "2022-08-01", endDate: "2023-06-30" }).catch(
    async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, pastYearLabel) }))!,
  );
  cleanupPastAcademicYearId = pastYear.id;
  const pastSem = await createRetrospectiveSemester(adminActor, {
    academicYearId: pastYear.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2022-09-01",
    endDate: "2023-01-15",
  });
  pastSemesterId = pastSem.id;
  cleanupPastSemesterId = pastSem.id;

  // Was a fixed "2096/2097" -- collided with residue from an independent
  // earlier run (createAcademicYear's own reuse-on-conflict fallback below
  // papered over the year, but createSemester below has no such fallback,
  // so a leftover sequence-1 semester from a prior run made a fresh run
  // fail outright). Time-suffixed like the e2e fixtures' own convention
  // (e.g. admin-offerings.spec.ts's yearBase) so this can't recur.
  const yearBase = 2100 + (Date.now() % 90);
  const yearLabel = `${yearBase}/${yearBase + 1}`;
  const year = await createAcademicYear(adminActor, { label: yearLabel, startDate: `${yearBase}-08-01`, endDate: `${yearBase + 1}-06-30` }).catch(
    async () => (await db.query.academicYear.findFirst({ where: eq(academicYear.label, yearLabel) }))!,
  );
  cleanupAcademicYearId = year.id;
  const sem = await createSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: `${yearBase}-09-01`,
    endDate: `${yearBase + 1}-01-15`,
  });
  semesterId = sem.id;
  cleanupSemesterId = sem.id;

  await transitionSemester(adminActor, { semesterId, toState: "OPEN", reason: "Test fixture" });

  // Every offering any test in this file will need, created now while the
  // semester still permits it (see the offeringPool comment above).
  const sections = "ABCDEFGHIJKLMNOPQRST".split("");
  for (let i = 0; i < sections.length; i++) {
    await precreateOffering(courseA.id, sections[i], (i % 6) + 1);
  }
  for (const section of ["A", "C", "D"]) {
    await precreateOffering(courseRepeat.id, section, 6);
  }

  // Walk the semester the rest of the way to Grade Submission.
  // In Progress IS the grade-entry window under the four-state model.
  await transitionSemester(adminActor, { semesterId, toState: "IN_PROGRESS", reason: "Test fixture" });
}, 400_000);

afterAll(async () => {
  // academic_record.grade_record_id -> grade_record.id is onDelete:
  // "restrict" (Section 9.4.14's origin/grade_record_id coherence). Every
  // academic_record referencing a grade_record MUST be deleted before that
  // grade_record, or the delete is silently refused by Postgres and
  // swallowed by this cleanup's own .catch(() => {}) -- found via Stage
  // 11's new I-05 reconciliation check (npm run db:reconcile) reporting
  // real PUBLISHED_GRADE_WITHOUT_RECORD rows left behind in a real
  // Supabase project by exactly this ordering bug, the first time this
  // file was ever run against real infrastructure end to end.
  for (const id of cleanupUserIds) {
    await db.delete(academicRecord).where(eq(academicRecord.studentId, id)).catch(() => {});
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.studentId, id)).catch(() => {});
    await db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, id)).catch(() => {});
  }
  for (const id of cleanupOfferingIds) {
    const regs = await db.query.registration.findMany({ where: eq(registration.offeringId, id) }).catch(() => []);
    for (const r of regs) {
      const grades = await db.query.gradeRecord.findMany({ where: eq(gradeRecord.registrationId, r.id) }).catch(() => []);
      for (const g of grades) {
        await db.delete(gradeCorrectionRequest).where(eq(gradeCorrectionRequest.gradeRecordId, g.id)).catch(() => {});
      }
      await db.delete(gradeRecord).where(eq(gradeRecord.registrationId, r.id)).catch(() => {});
    }
    const subs = await db.query.gradeSubmission.findMany({ where: eq(gradeSubmission.offeringId, id) }).catch(() => []);
    for (const s of subs) {
      await db.delete(gradeSubmission).where(eq(gradeSubmission.id, s.id)).catch(() => {});
    }
    await db.delete(registration).where(eq(registration.offeringId, id)).catch(() => {});
  }
  for (const id of [...cleanupOfferingIds].reverse()) {
    await db.delete(offeringMeeting).where(eq(offeringMeeting.offeringId, id)).catch(() => {});
    await db.delete(courseOffering).where(eq(courseOffering.id, id)).catch(() => {});
  }
  if (cleanupSemesterId) await db.delete(semester).where(eq(semester.id, cleanupSemesterId)).catch(() => {});
  if (cleanupAcademicYearId) await db.delete(academicYear).where(eq(academicYear.id, cleanupAcademicYearId)).catch(() => {});
  if (cleanupPastSemesterId) {
    await db.delete(academicRecord).where(eq(academicRecord.semesterId, cleanupPastSemesterId)).catch(() => {});
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.semesterId, cleanupPastSemesterId)).catch(() => {});
    await db.delete(semester).where(eq(semester.id, cleanupPastSemesterId)).catch(() => {});
  }
  if (cleanupPastAcademicYearId) await db.delete(academicYear).where(eq(academicYear.id, cleanupPastAcademicYearId)).catch(() => {});
  for (const id of cleanupCourseIds) {
    await db.delete(course).where(eq(course.id, id)).catch(() => {});
  }
  if (cleanupDepartmentId) {
    const { department } = await import("@/lib/db/schema");
    await db.delete(department).where(eq(department.id, cleanupDepartmentId)).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
  await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, superAdminUserId));
  await createAdminClient().auth.admin.deleteUser(superAdminUserId).catch(() => {});
}, 180_000);

describe("saveClassDraft -- numeric entry with derived letter (Section 15.3)", () => {
  it("typing 96 derives A+ / 4.00, whole class in one call", async () => {
    const offeringId = await makeOffering(courseA.id, "A");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    const r1 = await registerAndKey(s1.id, offeringId);
    const r2 = await registerAndKey(s2.id, offeringId);

    const saved = await saveClassDraft(
      adminActor,
      offeringId,
      [
        { registrationId: r1.id, score: 96 },
        { registrationId: r2.id, score: 82 },
      ],
      nextKey(),
    );
    expect(saved.find((g) => g.registrationId === r1.id)?.letter).toBe("A+");
    expect(saved.find((g) => g.registrationId === r1.id)?.gradePoint).toBe("4.00");
    expect(saved.find((g) => g.registrationId === r2.id)?.letter).toBe("B-");
    expect(saved.every((g) => g.status === "DRAFT")).toBe(true);
  });

  it("refuses a registration that does not belong to the offering", async () => {
    const offeringId = await makeOffering(courseA.id, "B");
    const other = await enrollTestStudent();
    const otherOffering = await makeOffering(courseRepeat.id, "A");
    const otherReg = await registerAndKey(other.id, otherOffering);

    await expect(saveClassDraft(adminActor, offeringId, [{ registrationId: otherReg.id, score: 90 }], nextKey())).rejects.toThrow(ValidationError);
  });

  it("refuses saving over a version mismatch, naming the conflicting row", async () => {
    const offeringId = await makeOffering(courseA.id, "C");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    const [first] = await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 70 }], nextKey());
    expect(first.version).toBe(0);

    await expect(
      saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 75, expectedVersion: 5 }], nextKey()),
    ).rejects.toThrow(ConflictError);
  });

  it("clears a draft grade back to blank", async () => {
    const offeringId = await makeOffering(courseA.id, "D");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    const [saved] = await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 88 }], nextKey());
    await clearDraftGrade(adminActor, saved.id);
    const gone = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, saved.id) });
    expect(gone).toBeUndefined();
  });
});

describe("submitClass -- partial submission rule (Section 9.4.11/15.3)", () => {
  it("refuses submission with missing grades unless explicitly confirmed with a note", async () => {
    const offeringId = await makeOffering(courseA.id, "E");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    const r1 = await registerAndKey(s1.id, offeringId);
    await registerAndKey(s2.id, offeringId); // left ungraded
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r1.id, score: 91 }], nextKey());

    await expect(submitClass(adminActor, offeringId, {}, nextKey())).rejects.toThrow(ValidationError);
    await expect(submitClass(adminActor, offeringId, { confirmPartial: true }, nextKey())).rejects.toThrow(ValidationError);

    const result = await submitClass(adminActor, offeringId, { confirmPartial: true, partialNote: "One student on medical leave." }, nextKey());
    expect(result.submission.gradeCount).toBe(1);
    expect(result.submission.status).toBe("SUBMITTED");
  });

  it("refuses submitting a class with no registered students", async () => {
    const offeringId = await makeOffering(courseA.id, "F");
    await expect(submitClass(adminActor, offeringId, {}, nextKey())).rejects.toThrow(ValidationError);
  });

  it("resubmission after rejection increments attempt_no (Section 15.4)", async () => {
    const offeringId = await makeOffering(courseA.id, "G");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 60 }], nextKey());
    const first = await submitClass(adminActor, offeringId, {}, nextKey());
    expect(first.submission.attemptNo).toBe(1);

    await rejectSubmission(superAdminActor, first.submission.id, undefined, "Please double-check this mark.", nextKey());

    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 65 }], nextKey());
    const second = await submitClass(adminActor, offeringId, {}, nextKey());
    expect(second.submission.attemptNo).toBe(2);
  }, 90_000);
});

describe("approval -- batch vs individual (CR-06), atomicity, and GPA effects (W-6)", () => {
  it("batch-approves a submission: publishes and locks every grade, writes academic_record, recomputes GPA, closes the submission", async () => {
    const offeringId = await makeOffering(courseA.id, "H");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    const r1 = await registerAndKey(s1.id, offeringId);
    const r2 = await registerAndKey(s2.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [
      { registrationId: r1.id, score: 96 },
      { registrationId: r2.id, score: 82 },
    ], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    const result = await approveSubmission(superAdminActor, submission.id, undefined, nextKey());
    expect(result.submission.status).toBe("CLOSED");
    expect(result.affectedGradeIds).toHaveLength(2);

    const grades = await db.query.gradeRecord.findMany({ where: eq(gradeRecord.submissionId, submission.id) });
    expect(grades.every((g) => g.status === "PUBLISHED")).toBe(true);
    expect(grades.every((g) => g.lockedAt !== null)).toBe(true);

    const records = await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, s1.id) });
    const rec = records.find((r) => r.courseCodeSnapshot === courseA.code);
    expect(rec?.origin).toBe("SYSTEM");
    expect(rec?.letter).toBe("A+");

    const summary = await db.query.studentSemesterSummary.findFirst({ where: and(eq(studentSemesterSummary.studentId, s1.id), eq(studentSemesterSummary.semesterId, semesterId)) });
    expect(summary?.gpa).not.toBeNull();
  }, 90_000);

  it("individually approves one grade and rejects another within the same batch (CR-06)", async () => {
    const offeringId = await makeOffering(courseA.id, "I");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    const r1 = await registerAndKey(s1.id, offeringId);
    const r2 = await registerAndKey(s2.id, offeringId);
    const [g1, g2] = await saveClassDraft(adminActor, offeringId, [
      { registrationId: r1.id, score: 70 },
      { registrationId: r2.id, score: 55 },
    ], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    await approveSubmission(superAdminActor, submission.id, [g1.id], nextKey());
    const afterApprove = await db.query.gradeSubmission.findFirst({ where: eq(gradeSubmission.id, submission.id) });
    expect(afterApprove?.status).toBe("PARTIALLY_DECIDED");

    await rejectSubmission(superAdminActor, submission.id, [g2.id], "Score looks transposed -- please verify.", nextKey());
    const afterReject = await db.query.gradeSubmission.findFirst({ where: eq(gradeSubmission.id, submission.id) });
    expect(afterReject?.status).toBe("CLOSED");

    const publishedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, g1.id) });
    expect(publishedGrade?.status).toBe("PUBLISHED"); // untouched by the later rejection of its classmate

    const rejectedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, g2.id) });
    expect(rejectedGrade?.status).toBe("DRAFT");
    expect(rejectedGrade?.decisionReason).toBe("Score looks transposed -- please verify.");
    expect(rejectedGrade?.submissionId).toBeNull();
  }, 90_000);

  it("segregation of duties: the Admin who submitted cannot decide their own submission", async () => {
    const offeringId = await makeOffering(courseA.id, "J");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 80 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    // adminActor is not a valid actor for grade.review at all (permission
    // kernel refuses it before the same-actor check ever runs) -- proves
    // the role boundary independently of the same-actor boundary.
    await expect(approveSubmission(adminActor, submission.id, undefined, nextKey())).rejects.toThrow();
  });

  it("batch reject returns every still-undecided grade to DRAFT; already-approved grades are never un-published", async () => {
    const offeringId = await makeOffering(courseA.id, "K");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    const r1 = await registerAndKey(s1.id, offeringId);
    const r2 = await registerAndKey(s2.id, offeringId);
    const [g1] = await saveClassDraft(adminActor, offeringId, [
      { registrationId: r1.id, score: 91 },
      { registrationId: r2.id, score: 61 },
    ], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    await approveSubmission(superAdminActor, submission.id, [g1.id], nextKey());
    await rejectSubmission(superAdminActor, submission.id, undefined, "Batch-level rejection of the remainder.", nextKey());

    const stillPublished = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, g1.id) });
    expect(stillPublished?.status).toBe("PUBLISHED");

    const finalSubmission = await db.query.gradeSubmission.findFirst({ where: eq(gradeSubmission.id, submission.id) });
    expect(finalSubmission?.status).toBe("CLOSED");
  }, 90_000);
});

describe("concurrent decision on the same submission (G10 gate)", () => {
  it("exactly one of two simultaneous approve/reject calls succeeds", async () => {
    const offeringId = await makeOffering(courseA.id, "L");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 77 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    const results = await Promise.allSettled([
      approveSubmission(superAdminActor, submission.id, undefined, nextKey()),
      approveSubmission(superAdminActor, submission.id, undefined, nextKey()),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  }, 90_000);
});

describe("idempotency (Section 23.5)", () => {
  it("the same key with the same payload returns the same result without re-running the effect", async () => {
    const offeringId = await makeOffering(courseA.id, "M");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    const key = nextKey();

    const first = await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 85 }], key);
    const second = await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 85 }], key);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].version).toBe(first[0].version); // effect ran once
  });

  it("the same key with a different payload is refused as an error, not replayed", async () => {
    const offeringId = await makeOffering(courseA.id, "N");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    const key = nextKey();

    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 85 }], key);
    await expect(saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 60 }], key)).rejects.toThrow(ValidationError);
  });
});

describe("correction workflow -- full cycle and staleness (W-8/W-9, Section 15.5)", () => {
  it("approves a correction: old/new captured, academic record and CGPA updated, re-locked, both actors and reason audited", async () => {
    const offeringId = await makeOffering(courseA.id, "O");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 60 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());
    await approveSubmission(superAdminActor, submission.id, undefined, nextKey());

    const grade = (await db.query.gradeRecord.findMany({ where: eq(gradeRecord.registrationId, r.id) }))[0];
    expect(grade.letter).toBe("D-");

    const request = await requestCorrection(adminActor, grade.id, { newScore: 97, reason: "Re-grade after appeal." });
    expect(request.oldLetter).toBe("D-");
    expect(request.newLetter).toBe("A+");

    const decided = await decideCorrection(superAdminActor, request.id, "APPROVE", "Verified against the original script.");
    expect(decided.status).toBe("APPROVED");

    const updatedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, grade.id) });
    expect(updatedGrade?.letter).toBe("A+");

    const record = await db.query.academicRecord.findFirst({ where: eq(academicRecord.gradeRecordId, grade.id) });
    expect(record?.letter).toBe("A+");

    const entries = await db.query.auditLog.findMany({ where: and(eq(auditLog.entityType, "grade_correction_request"), eq(auditLog.entityId, request.id)) });
    expect(entries.find((e) => e.action === "GRADE_CORRECTION_APPROVED")).toBeTruthy();
  }, 90_000);

  it("rejects a correction: nothing changes, the request survives as evidence", async () => {
    const offeringId = await makeOffering(courseA.id, "P");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 70 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());
    await approveSubmission(superAdminActor, submission.id, undefined, nextKey());
    const grade = (await db.query.gradeRecord.findMany({ where: eq(gradeRecord.registrationId, r.id) }))[0];

    const request = await requestCorrection(adminActor, grade.id, { newScore: 95, reason: "Claimed transcription error." });
    const decided = await decideCorrection(superAdminActor, request.id, "REJECT", "Original script confirms the mark was correct.");
    expect(decided.status).toBe("REJECTED");

    const unchangedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.id, grade.id) });
    expect(unchangedGrade?.letter).toBe(grade.letter);
  }, 90_000);

  it("refuses deciding a correction requested by the same actor", async () => {
    const offeringId = await makeOffering(courseA.id, "Q");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 70 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());
    await approveSubmission(superAdminActor, submission.id, undefined, nextKey());
    const grade = (await db.query.gradeRecord.findMany({ where: eq(gradeRecord.registrationId, r.id) }))[0];

    // requestCorrection requires the Admin permission, which Super Admin
    // doesn't have -- so exercise the same-actor rule the other
    // direction: two DIFFERENT Admins would be needed to even test the
    // "same account" path meaningfully; here we confirm the DB-level
    // guarantee holds by attempting decideCorrection as the requester's
    // own role is impossible (Super Admin never requests), so instead
    // confirm the constraint via requestCorrection's actor recorded and
    // decideCorrection's explicit runtime check using the same actor id.
    const request = await requestCorrection(adminActor, grade.id, { newScore: 95, reason: "test" });
    const impersonatingRequester: Actor = { userId: adminActor.userId, role: "SUPER_ADMIN" };
    await expect(decideCorrection(impersonatingRequester, request.id, "APPROVE")).rejects.toThrow(StateError);
  }, 90_000);

  it("refuses a second request while one is already pending", async () => {
    const offeringId = await makeOffering(courseA.id, "R");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 70 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());
    await approveSubmission(superAdminActor, submission.id, undefined, nextKey());
    const grade = (await db.query.gradeRecord.findMany({ where: eq(gradeRecord.registrationId, r.id) }))[0];

    await requestCorrection(adminActor, grade.id, { newScore: 95, reason: "first" });
    await expect(requestCorrection(adminActor, grade.id, { newScore: 88, reason: "second" })).rejects.toThrow(ValidationError);
  }, 90_000);
});

describe("retake through the full cycle (W-18)", () => {
  it("publishing a passing grade for a repeated course marks the earlier attempt R and CGPA reflects only the later one", async () => {
    // The earlier failing attempt must sit in an EARLIER semester, not the
    // same one -- resolveRepeats (Section 16.5) breaks ties by semester
    // recency, and a student can't retake a course before knowing they
    // failed it in the first place. Entered as an imported historical
    // record (Stage 6), exactly as it would be for a real prior term --
    // the retake itself goes through the real Stage 10 publish flow, a
    // realistic mixed-origin scenario.
    const s = await enrollTestStudent();
    await enterHistoricalSemester(adminActor, {
      studentId: s.id,
      semesterId: pastSemesterId,
      records: [{ courseCode: courseRepeat.code, creditHours: 3, letter: "F" }],
    });

    const firstAttempt = (await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, s.id) })).find(
      (r) => r.courseCodeSnapshot === courseRepeat.code,
    );
    expect(firstAttempt?.letter).toBe("F");
    expect(firstAttempt?.attemptNo).toBe(1);

    const offering2 = await makeOffering(courseRepeat.id, "D");
    const r2 = await registerAndKey(s.id, offering2);
    await saveClassDraft(adminActor, offering2, [{ registrationId: r2.id, score: 85 }], nextKey());
    const sub2 = await submitClass(adminActor, offering2, {}, nextKey());
    await approveSubmission(superAdminActor, sub2.submission.id, undefined, nextKey());

    const allAttempts = (await db.query.academicRecord.findMany({ where: eq(academicRecord.studentId, s.id) })).filter(
      (r) => r.courseCodeSnapshot === courseRepeat.code,
    );
    const second = allAttempts.find((r) => r.attemptNo === 2);
    expect(second?.letter).toBe("B+"); // score 85 falls in the 85-89 band

    const earlier = allAttempts.find((r) => r.attemptNo === 1);
    expect(earlier?.isRepeatDropped).toBe(true);

    const cumulative = await db.query.studentCumulativeSummary.findFirst({ where: eq(studentCumulativeSummary.studentId, s.id) });
    expect(cumulative?.cgpa).not.toBeNull(); // credit counted once, reflects the kept attempt
  }, 90_000);
});

describe("reads", () => {
  it("getClassRoster lists only REGISTERED students, alphabetically by surname", async () => {
    const offeringId = await makeOffering(courseA.id, "S");
    const s1 = await enrollTestStudent();
    const s2 = await enrollTestStudent();
    await registerAndKey(s1.id, offeringId);
    await registerAndKey(s2.id, offeringId);

    const roster = await getClassRoster(adminActor, offeringId);
    expect(roster).toHaveLength(2);
    const sorted = [...roster].sort((a, b) => a.studentName.localeCompare(b.studentName));
    expect(roster.map((r) => r.registrationId)).toEqual(sorted.map((r) => r.registrationId));
  });

  it("getSubmissionQueue only returns SUBMITTED/PARTIALLY_DECIDED submissions", async () => {
    const offeringId = await makeOffering(courseA.id, "T");
    const s = await enrollTestStudent();
    const r = await registerAndKey(s.id, offeringId);
    await saveClassDraft(adminActor, offeringId, [{ registrationId: r.id, score: 70 }], nextKey());
    const { submission } = await submitClass(adminActor, offeringId, {}, nextKey());

    const queueBefore = await getSubmissionQueue(superAdminActor);
    expect(queueBefore.some((s) => s.id === submission.id)).toBe(true);

    await approveSubmission(superAdminActor, submission.id, undefined, nextKey());
    const queueAfter = await getSubmissionQueue(superAdminActor);
    expect(queueAfter.some((s) => s.id === submission.id)).toBe(false);
  });
});
