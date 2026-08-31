import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { academicRecord, appUser, academicYear, course, courseOffering, department, gradeRecord, gradeSubmission, offeringMeeting, registration, semester, studentCumulativeSummary, studentSemesterSummary } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";
import { createAcademicYear, createSemester, transitionSemester } from "../src/lib/academic/calendar";
import { createCourse } from "../src/lib/academic/structure";
import { addMeeting, createOffering, publishOffering } from "../src/lib/offerings/offerings";
import { enrollStudent } from "../src/lib/students/students";
import { registerDirect } from "../src/lib/planning/planning";

/**
 * Stage 10 e2e coverage (plan Section 24.11, G10): the grade lifecycle
 * had no browser-driven coverage before this file -- only unit/integration
 * tests against the service layer. Covers the path the plan itself calls
 * "the highest-risk area": Admin enters and submits a class's grades,
 * a different Super Admin approves the submission, and the grade is
 * published. Written and typechecked against the real page source
 * (src/app/admin/grades/ClassEntryForm.tsx, src/app/admin/grade-review/
 * [submissionId]/page.tsx) but NOT run-verified in this environment --
 * this repository's Supabase project is a placeholder with no real Auth
 * backend (see the local execution checklist).
 */

const PASSWORD = "TestPassword12345!";
const cleanupUserIds: string[] = [];
const cleanupOfferingIds: string[] = [];
const cleanupCourseIds: string[] = [];
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];

async function makeSignedInStaff(role: "ADMIN" | "SUPER_ADMIN" | "STUDENT", label: string) {
  const username = `e2e-${label}-${Date.now()}`;
  const email = resolveLoginIdentifierToEmail(username);
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`setup failed: ${error?.message}`);

  await db.insert(appUser).values({
    id: data.user.id,
    loginIdentifier: username,
    displayName: `E2E ${label}`,
    role,
    status: "ACTIVE",
    mustChangePassword: false,
  });

  cleanupUserIds.push(data.user.id);
  return { username, password: PASSWORD, userId: data.user.id };
}

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  // Fixed four bugs found by actually running this against real Supabase
  // (same class as DECISIONS.md DEV-15's grades.integration.test.ts
  // finding): (1) gradeRecord was matched on registrationId === offeringId
  // (always false, a silent no-op); (2) academic_record (created once the
  // grade is published) references grade_record with onDelete:"restrict",
  // so it must go first or the delete is refused and swallowed by
  // .catch(() => {}); (3) grade_submission references course_offering
  // with onDelete:"restrict" and was never deleted at all here; (4)
  // offeringMeeting (added when fixing the "publish needs a meeting time"
  // bug) references course_offering the same way and was likewise never
  // cleaned up. Any one of the four alone blocks the offering/semester
  // delete chain below via FK restrict -- confirmed by fixing them one at
  // a time, each surfacing the next only once the previous was gone.
  for (const id of cleanupUserIds) {
    await db.delete(academicRecord).where(eq(academicRecord.studentId, id)).catch(() => {});
  }
  // recomputeStudentSummaries (called by approveSubmission once the grade
  // publishes) writes student_semester_summary, keyed to this semester --
  // a 5th onDelete:"restrict" reference this cleanup missed, blocking the
  // semester delete below even after every offering-side reference was
  // gone.
  for (const id of cleanupSemesterIds) {
    await db.delete(studentSemesterSummary).where(eq(studentSemesterSummary.semesterId, id)).catch(() => {});
  }
  for (const id of cleanupOfferingIds) {
    const regs = await db.query.registration.findMany({ where: eq(registration.offeringId, id) }).catch(() => []);
    for (const r of regs) {
      await db.delete(gradeRecord).where(eq(gradeRecord.registrationId, r.id)).catch(() => {});
    }
    await db.delete(gradeSubmission).where(eq(gradeSubmission.offeringId, id)).catch(() => {});
    await db.delete(registration).where(eq(registration.offeringId, id)).catch(() => {});
    await db.delete(offeringMeeting).where(eq(offeringMeeting.offeringId, id)).catch(() => {});
    await db.delete(courseOffering).where(eq(courseOffering.id, id)).catch(() => {});
  }
  for (const id of cleanupSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  for (const id of cleanupAcademicYearIds) {
    await db.delete(academicYear).where(eq(academicYear.id, id)).catch(() => {});
  }
  for (const id of cleanupCourseIds) {
    await db.delete(course).where(eq(course.id, id)).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    // A 6th leftover found the same way as the other five above --
    // non-blocking (no FK from student_cumulative_summary reaches
    // semester/offering, so it never produced a stuck-semester symptom),
    // but confirmed via db:reconcile's I-15 self-heal that it was never
    // cleaned up here at all.
    await db.delete(studentCumulativeSummary).where(eq(studentCumulativeSummary.studentId, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin enters and submits a class's grades; a different Super Admin approves; the grade publishes", async ({ page }) => {
  test.setTimeout(240_000);

  const admin = await makeSignedInStaff("ADMIN", "grades-admin");
  const superAdmin = await makeSignedInStaff("SUPER_ADMIN", "grades-superadmin");
  const adminActor = { userId: admin.userId, role: "ADMIN" as const };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to run this test against.");

  const courseCode = `E2EGRD${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, { departmentId: dept.id, code: courseCode, title: "E2E Grades Course", creditHours: 3 });
  cleanupCourseIds.push(courseRow.id);

  const yearBase = 2300 + (Date.now() % 90);
  const year = await createAcademicYear(adminActor, {
    label: `${yearBase}/${yearBase + 1}`,
    startDate: `${yearBase}-08-01`,
    endDate: `${yearBase + 1}-06-30`,
  });
  cleanupAcademicYearIds.push(year.id);
  const sem = await createSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: `${yearBase}-09-01`,
    endDate: `${yearBase + 1}-01-15`,
  });
  cleanupSemesterIds.push(sem.id);

  // Offerings can only be created/edited while the semester is Draft, Open
  // or Registration (offerings.ts assertSemesterEditable) -- set up and
  // publish the offering before advancing past Registration.
  const offering = await createOffering(adminActor, { semesterId: sem.id, courseId: courseRow.id, section: "A", instructorName: "Dr. E2E" });
  cleanupOfferingIds.push(offering.id);
  await addMeeting(adminActor, offering.id, { dayOfWeek: 1, startTime: "09:00", endTime: "10:30", room: "E2E-1" });
  await publishOffering(adminActor, offering.id);

  await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN" });
  await transitionSemester(adminActor, { semesterId: sem.id, toState: "REGISTRATION" });

  // Student ID must start with "19" or "20" (STUDENT_ID_PATTERN) --
  // decoupled from yearBase (2300+, fine for an academic year label with
  // no such format constraint, but rejected outright here).
  const enrolmentYear = 2021;
  const studentNumber = `${enrolmentYear}${Date.now() % 10000}`;
  const enrolled = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Grade",
    lastName: `Fixture-${studentNumber}`,
    departmentId: dept.id,
    enrolmentYear,
  });
  const studentRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, enrolled.studentNumber) });
  if (!studentRow) throw new Error("enrollment fixture setup failed");
  cleanupUserIds.push(studentRow.id);

  await registerDirect(adminActor, studentRow.id, offering.id, "e2e fixture");

  await transitionSemester(adminActor, { semesterId: sem.id, toState: "IN_PROGRESS" });
  await transitionSemester(adminActor, { semesterId: sem.id, toState: "GRADE_SUBMISSION" });

  const reg = await db.query.registration.findFirst({ where: eq(registration.offeringId, offering.id) });
  if (!reg) throw new Error("registration fixture setup failed");

  // --- Admin enters and submits the grade ---
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto(`/admin/grades?semesterId=${sem.id}&offeringId=${offering.id}`);
  await expect(page.getByRole("heading", { name: "Class grade entry" })).toBeVisible();

  // The live letter/grade-point preview is a client component
  // (ClassEntryForm.tsx) that must finish hydrating before its onChange
  // handler is attached -- filling immediately on page load can race that
  // and miss the preview text even though the underlying score value (and
  // therefore the actual save) is unaffected. Not asserted here; the
  // derived letter is verified precisely at the end of this test via the
  // published academic record instead, which is what actually matters.
  const scoreInput = page.locator(`input[name="score_${reg.id}"]`);
  await scoreInput.waitFor({ state: "visible" });
  await scoreInput.fill("93");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("1 of 1 entered")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Submit" }).click();
  // submitClassAction (src/app/admin/grades/actions.ts) redirects to
  // /admin/grades?offeringId=... only -- semesterId is dropped, unlike the
  // GET-form navigations elsewhere on this page. Real app behavior, not a
  // bug: the roster/entry section renders off offeringId alone.
  await expect(page).toHaveURL(new RegExp(`/admin/grades\\?offeringId=${offering.id}$`), { timeout: 30_000 });

  // --- A different Super Admin reviews and approves ---
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password").fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/grade-review");
  await expect(page.getByRole("heading", { name: "Grade submission review" })).toBeVisible();
  await page.getByRole("link", { name: "Review" }).first().click();

  await page.getByRole("button", { name: "Approve checked (or all, if none checked)" }).click();
  // approveSubmissionAction (src/app/admin/grade-review/actions.ts)
  // redirects back to the same detail page, not the queue list -- real
  // app behavior. With the only grade now decided, the status line shows
  // CLOSED and the decision form (which only renders while grades remain
  // undecided) disappears.
  await expect(page).toHaveURL(/\/admin\/grade-review\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByText("CLOSED", { exact: true })).toBeVisible({ timeout: 30_000 });

  // --- Verify the grade actually published, at the data layer (the most
  // reliable check available without guessing exact confirmation copy) ---
  const publishedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.registrationId, reg.id) });
  expect(publishedGrade?.status).toBe("PUBLISHED");
  expect(publishedGrade?.letter).toBe("A-");
});
