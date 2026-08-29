import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, academicYear, course, courseOffering, department, gradeRecord, registration, semester } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";
import { createAcademicYear, createSemester, transitionSemester } from "../src/lib/academic/calendar";
import { createCourse } from "../src/lib/academic/structure";
import { createOffering, publishOffering } from "../src/lib/offerings/offerings";
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
  testInfo.setTimeout(60_000);
  for (const id of cleanupOfferingIds) {
    await db.delete(gradeRecord).where(eq(gradeRecord.registrationId, id)).catch(() => {});
    await db.delete(registration).where(eq(registration.offeringId, id)).catch(() => {});
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
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin enters and submits a class's grades; a different Super Admin approves; the grade publishes", async ({ page }) => {
  test.setTimeout(180_000);

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
  await publishOffering(adminActor, offering.id);

  await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN" });
  await transitionSemester(adminActor, { semesterId: sem.id, toState: "REGISTRATION" });

  const studentNumber = `${yearBase}${Date.now() % 10000}`;
  const enrolled = await enrollStudent(adminActor, {
    studentNumber,
    firstName: "Grade",
    lastName: `Fixture-${studentNumber}`,
    departmentId: dept.id,
    enrolmentYear: yearBase,
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

  await page.locator(`input[name="score_${reg.id}"]`).fill("93");
  await expect(page.getByText("A- — 3.70", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("1 of 1 entered")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/grades\\?semesterId=${sem.id}&offeringId=${offering.id}$`), { timeout: 30_000 });

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
  await expect(page).toHaveURL(/\/admin\/grade-review$/, { timeout: 30_000 });

  // --- Verify the grade actually published, at the data layer (the most
  // reliable check available without guessing exact confirmation copy) ---
  const publishedGrade = await db.query.gradeRecord.findFirst({ where: eq(gradeRecord.registrationId, reg.id) });
  expect(publishedGrade?.status).toBe("PUBLISHED");
  expect(publishedGrade?.letter).toBe("A-");
});
