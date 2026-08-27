import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, academicRecord, academicYear, course, semester, student, department } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";
import { createAcademicYear } from "../src/lib/academic/calendar";
import { createCourse } from "../src/lib/academic/structure";
import { enrollStudent } from "../src/lib/students/students";
import { createRetrospectiveSemester } from "../src/lib/historical/historical";

/**
 * Stage 6 G6 gate (plan Section 24.7): an Admin enters a full past
 * semester for a real student in one save, sees it on the student's
 * record, and can mark the import Complete. Fixture data (student,
 * course, retrospective semester) is created directly through the real
 * service functions -- the same functions the UI calls -- so only the
 * historical-entry screen itself is driven through the browser.
 */

const PASSWORD = "TestPassword12345!";
const cleanupUserIds: string[] = [];
const cleanupStudentUserIds: string[] = [];
const cleanupCourseIds: string[] = [];
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];

async function makeSignedInStaff(role: "ADMIN" | "SUPER_ADMIN", label: string) {
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
  return { username, password: PASSWORD };
}

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  for (const id of cleanupStudentUserIds) {
    await db.delete(academicRecord).where(eq(academicRecord.studentId, id)).catch(() => {});
    await db.delete(student).where(eq(student.id, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id)).catch(() => {});
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
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

test("Admin enters a full past semester for a student in one save, then marks the import Complete", async ({ page }) => {
  test.setTimeout(180_000);

  const admin = await makeSignedInStaff("ADMIN", "historical-admin");
  const adminRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, admin.username) });
  const adminActor = { userId: adminRow!.id, role: "ADMIN" as const };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to run this test against.");

  const courseCode = `E2EHIST${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, {
    departmentId: dept.id,
    code: courseCode,
    title: "E2E Historical Course",
    creditHours: 3,
  });
  cleanupCourseIds.push(courseRow.id);

  const year = await createAcademicYear(adminActor, {
    label: "2017/2018",
    startDate: "2017-08-01",
    endDate: "2018-06-30",
  });
  cleanupAcademicYearIds.push(year.id);

  const pastSemester = await createRetrospectiveSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: "2017-09-01",
    endDate: "2018-01-15",
  });
  cleanupSemesterIds.push(pastSemester.id);

  const enrolled = await enrollStudent(adminActor, {
    studentNumber: `2017${Math.floor(1000 + Math.random() * 9000)}`,
    firstName: "E2E",
    lastName: "Historical",
    departmentId: dept.id,
    enrolmentYear: 2017,
  });
  const studentRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, enrolled.studentNumber) });
  cleanupStudentUserIds.push(studentRow!.id);

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto(`/admin/historical?studentId=${studentRow!.id}`);
  await expect(page.getByRole("heading", { name: "E2E Historical" })).toBeVisible();

  await page.getByLabel("Semester").selectOption({ value: pastSemester.id });
  await page.getByRole("button", { name: "Select" }).click();

  await page.locator('input[name="courseCode-0"]').fill(courseCode);
  await page.locator('input[name="creditHours-0"]').fill("3");
  await page.locator('input[name="letter-0"]').fill("B+");
  await page.locator('input[name="courseCode-1"]').fill("UNKNOWNCODE1");
  await page.locator('input[name="creditHours-1"]').fill("3");
  await page.locator('input[name="letter-1"]').fill("A-");
  await page.getByRole("button", { name: "Save semester" }).click();
  // The save does several sequential DB round trips (grade-scale lookup,
  // existing-record check, two inserts, two audit writes, a student
  // status update) -- wait on the redirect itself, not the default 15s
  // expect timeout, matching the lesson from Stage 4's e2e timeouts.
  await page.waitForURL(/entered=/, { timeout: 60_000 });

  await expect(page.getByText(/Saved 2 record\(s\)/)).toBeVisible();
  await expect(page.getByText(/1 warning\(s\)/)).toBeVisible();

  await expect(page.getByText(courseCode, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("(not in catalogue)")).toBeVisible();

  await expect(page.getByText("IN_PROGRESS")).toBeVisible();
  await page.getByRole("button", { name: "Mark import Complete" }).click();
  await page.waitForURL((url) => !url.search.includes("entered="), { timeout: 30_000 });
  await expect(page.getByText("COMPLETE", { exact: true })).toBeVisible();

  await page.goto(`/admin/students/${studentRow!.id}`);
  await expect(page.getByText(courseCode, { exact: false }).first()).toBeVisible();
});

test("Super Admin sees a student's historical record read-only", async ({ page }) => {
  const superAdmin = await makeSignedInStaff("SUPER_ADMIN", "historical-superadmin");

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to run this test against.");

  const setupAdmin = await makeSignedInStaff("ADMIN", "historical-setup-admin");
  const setupAdminRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, setupAdmin.username) });
  const setupActor = { userId: setupAdminRow!.id, role: "ADMIN" as const };

  const enrolled = await enrollStudent(setupActor, {
    studentNumber: `2017${Math.floor(1000 + Math.random() * 9000)}`,
    firstName: "ReadOnly",
    lastName: "Check",
    departmentId: dept.id,
    enrolmentYear: 2017,
  });
  const studentRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, enrolled.studentNumber) });
  cleanupStudentUserIds.push(studentRow!.id);

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password").fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto(`/admin/historical?studentId=${studentRow!.id}`);
  await expect(page.getByRole("heading", { name: "ReadOnly Check" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark import Complete" })).toHaveCount(0);
  await expect(page.getByText("Enter a past semester")).toHaveCount(0);
});
