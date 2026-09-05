import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, academicYear, course, courseOffering, department, offeringMeeting, semester } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";
import { createAcademicYear, createSemester } from "../src/lib/academic/calendar";
import { createCourse } from "../src/lib/academic/structure";

/**
 * Stage 8 G8 gate (plan Section 24.9): an Admin creates an offering with
 * a meeting time and publishes it; Super Admin sees the same list
 * read-only; a Student is refused the admin screen.
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
  return { username, password: PASSWORD };
}

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  for (const id of cleanupOfferingIds) {
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
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin creates an offering, adds a meeting time, and publishes it", async ({ page }) => {
  test.setTimeout(150_000);

  const admin = await makeSignedInStaff("ADMIN", "offerings-admin");
  const adminRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, admin.username) });
  const adminActor = { userId: adminRow!.id, role: "ADMIN" as const };

  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to run this test against.");

  const courseCode = `E2EOFF${Date.now() % 10000}`;
  const courseRow = await createCourse(adminActor, {
    departmentId: dept.id,
    code: courseCode,
    title: "E2E Offerings Course",
    creditHours: 3,
  });
  cleanupCourseIds.push(courseRow.id);

  const yearBase = 2200 + (Date.now() % 90);
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

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto(`/admin/offerings?semesterId=${sem.id}`);
  await expect(page.getByRole("heading", { name: "Course offerings" })).toBeVisible();

  await page.getByLabel("Course").selectOption({ value: courseRow.id });
  await page.getByLabel("Section").fill("A");
  await page.getByLabel("Instructor").fill("Dr. Test");
  await page.getByRole("button", { name: "Add offering" }).click();
  // Already on the ?semesterId= URL from the page.goto above, so
  // waitForURL on that same pattern would resolve immediately without
  // waiting for this round trip -- wait on the resulting DOM instead.
  await expect(page.getByText(courseCode, { exact: false }).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();

  const offeringRow = await db.query.courseOffering.findFirst({ where: eq(courseOffering.courseId, courseRow.id) });
  cleanupOfferingIds.push(offeringRow!.id);

  // The offerings screen is one table for every role now; an Admin's
  // controls live behind the row's "Manage" disclosure rather than in a
  // per-offering card.
  await page.getByText("Manage", { exact: true }).first().click();
  await page.locator('select[name="dayOfWeek"]').selectOption("1");
  await page.locator('input[name="startTime"]').fill("09:00");
  await page.locator('input[name="endTime"]').fill("10:30");
  await page.locator('input[name="room"]').fill("B4");
  await page.getByRole("button", { name: "Add meeting", exact: true }).click();
  // "Add offering" and "Add meeting" both redirect to the exact same
  // ?semesterId= URL, so waitForURL on that pattern resolves immediately
  // here without waiting for this second round trip at all -- wait
  // directly on the resulting DOM instead, with a generous timeout for
  // the real Supabase round trip.
  await expect(page.getByRole("cell", { name: "Monday", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("09:00", { exact: false })).toBeVisible();

  await page.getByText("Manage", { exact: true }).first().click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("Super Admin sees offerings read-only; a Student is refused", async ({ page }) => {
  const superAdmin = await makeSignedInStaff("SUPER_ADMIN", "offerings-superadmin");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password", { exact: true }).fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/offerings");
  await expect(page.getByRole("heading", { name: "Course offerings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add offering" })).toHaveCount(0);

  const student = await makeSignedInStaff("STUDENT", "offerings-student");
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(student.username);
  await page.getByLabel("Password", { exact: true }).fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/offerings");
  await expect(page.getByText("Not available to your role.")).toBeVisible();
});
