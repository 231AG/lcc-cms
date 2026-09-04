import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, department, student } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";

/**
 * Stage 5 G5 gate (plan Section 24.6): an Admin enrols a student, who logs
 * in, changes their temporary password, and sees their own -- empty --
 * record. A Student is refused the admin screens. A Super Admin sees the
 * list read-only.
 */

const PASSWORD = "TestPassword12345!";
const cleanupUserIds: string[] = [];
const cleanupStudentUserIds: string[] = [];

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

test.afterAll(async () => {
  for (const id of cleanupStudentUserIds) {
    await db.delete(student).where(eq(student.id, id)).catch(() => {});
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id)).catch(() => {});
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin enrols a student, who logs in, changes password, and sees their own record", async ({ page }) => {
  test.setTimeout(150_000);

  const admin = await makeSignedInStaff("ADMIN", "students-admin");
  const dept = await db.query.department.findFirst({ where: eq(department.isActive, true) });
  if (!dept) throw new Error("No active department exists to run this test against.");

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const studentNumber = `2026${suffix}`;

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/students");
  await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible();

  // The enrolment form is behind the "+ Add Student" primary action since
  // the student-listing redesign; it is the same form, same fields, same
  // action, just no longer always expanded on the page.
  await page.getByRole("button", { name: "Add Student" }).click();

  // Scoped to the panel: the page's filter row now also has "Department"
  // and "Enrolment year" controls, so an unscoped label lookup is genuinely
  // ambiguous and should say which one it means rather than rely on
  // whichever happens to come first in the DOM.
  const enrolPanel = page.locator("#enrol-student-panel");
  await enrolPanel.getByLabel("Student ID").fill(studentNumber);
  await enrolPanel.getByLabel("First name").fill("Playwright");
  await enrolPanel.getByLabel("Last name").fill("Enrollee");
  await enrolPanel.getByLabel("Department").selectOption({ value: dept.id });
  await enrolPanel.getByLabel("Enrolment year").fill("2026");
  await enrolPanel.getByRole("button", { name: "Enrol student" }).click();

  await expect(page.getByText("Student enrolled.")).toBeVisible();
  const tempPasswordLocator = page.locator("code").last();
  const temporaryPassword = await tempPasswordLocator.innerText();
  expect(temporaryPassword.length).toBeGreaterThan(0);

  const createdRow = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, studentNumber) });
  if (!createdRow) throw new Error("enrollment did not create an app_user row");
  cleanupStudentUserIds.push(createdRow.id);

  await expect(page.getByRole("cell", { name: studentNumber, exact: true })).toBeVisible();

  // Log in as the newly enrolled student.
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(studentNumber);
  await page.getByLabel("Password", { exact: true }).fill(temporaryPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("New password", { exact: true }).fill("BrandNewPassword12345!");
  await page.getByLabel("Confirm new password").fill("BrandNewPassword12345!");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await expect(page.getByRole("heading", { name: "Playwright Enrollee" })).toBeVisible();
  await expect(page.getByText(studentNumber)).toBeVisible();
  await expect(page.getByText("ACTIVE")).toBeVisible();

  // A Student is refused the admin screens, including this student's own
  // detail page reached directly by id.
  await page.goto("/admin/students");
  await expect(page.getByText("Not available to your role.")).toBeVisible();
  await page.goto(`/admin/students/${createdRow.id}`);
  await expect(page.getByText("Not available to your role.")).toBeVisible();
});

test("Super Admin sees the student list read-only", async ({ page }) => {
  const superAdmin = await makeSignedInStaff("SUPER_ADMIN", "students-superadmin");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password", { exact: true }).fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/students");
  await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
  // Neither the submit button nor the control that reveals it: a Super
  // Admin cannot enrol a student (REQ-R04), so neither should exist.
  await expect(page.getByRole("button", { name: "Enrol student" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Student" })).toHaveCount(0);
  // ...but the read-only list itself is still there (X-07).
  await expect(page.getByRole("columnheader", { name: "Student ID" })).toBeVisible();
});
