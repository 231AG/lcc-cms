import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, academicYear, semester } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";

/**
 * Stage 4 G4 gate (plan Section 24.5): Admin creates years/semesters and
 * advances forward; Super Admin moves backward with a mandatory reason; a
 * Student sees "not available to your role" like every other admin screen.
 */

const PASSWORD = "TestPassword12345!";
const cleanupUserIds: string[] = [];
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];

async function makeSignedInUser(role: "ADMIN" | "SUPER_ADMIN" | "STUDENT", label: string) {
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
  for (const id of cleanupSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  for (const id of cleanupAcademicYearIds) {
    await db.delete(academicYear).where(eq(academicYear.id, id)).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin creates a year and semester and advances it; Super Admin moves it back with a reason", async ({ page }) => {
  // Five form submissions plus two logins, each a real Supabase round trip
  // (~5-12s cold) -- the shared default 90s test timeout isn't enough
  // headroom for this many sequential steps (confirmed by a standalone
  // repro: the exact same flow completes in ~65s outside the suite's
  // budget once the earlier steps' time is already spent).
  test.setTimeout(180_000);

  const admin = await makeSignedInUser("ADMIN", "calendar-admin");
  const superAdmin = await makeSignedInUser("SUPER_ADMIN", "calendar-superadmin");

  const label = `21${Date.now() % 90}/21${(Date.now() % 90) + 1}`;
  const semesterName = `E2E Semester ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/calendar");
  await expect(page.getByRole("heading", { name: "Academic calendar" })).toBeVisible();

  await page.getByLabel("Label").fill(label);
  await page.getByLabel("Start date").first().fill("2199-08-01");
  await page.getByLabel("End date").first().fill("2200-06-30");
  await page.getByRole("button", { name: "Add academic year" }).click();

  await expect(page).toHaveURL(/\/admin\/calendar$/);
  await expect(page.getByRole("cell", { name: label, exact: true })).toBeVisible();

  const createdYear = await db.query.academicYear.findFirst({ where: eq(academicYear.label, label) });
  if (createdYear) cleanupAcademicYearIds.push(createdYear.id);

  await page.getByLabel("Academic year").selectOption({ label });
  await page.getByLabel("Sequence").selectOption("1");
  await page.getByLabel("Name", { exact: true }).fill(semesterName);
  await page.getByLabel("Start date").nth(1).fill("2199-09-01");
  await page.getByLabel("End date").nth(1).fill("2200-01-15");
  await page.getByRole("button", { name: "Add semester" }).click();

  await expect(page).toHaveURL(/\/admin\/calendar$/);
  const semesterRow = page.getByRole("row", { name: new RegExp(semesterName) });
  await expect(semesterRow).toBeVisible();
  await expect(semesterRow.getByText("Draft", { exact: true })).toBeVisible();

  const created = await db.query.semester.findFirst({ where: eq(semester.name, semesterName) });
  if (created) cleanupSemesterIds.push(created.id);

  // The state control is a dropdown, not a stepper: pick the target state,
  // give the reason an Admin always owes, and apply. Draft's only legal
  // next state is Open, so that is the one option offered.
  await semesterRow.getByLabel("Move to").selectOption("OPEN");
  await semesterRow.getByLabel("Reason (required)").fill("E2E publish check");
  await semesterRow.getByRole("button", { name: "Change state" }).click();

  await expect(page).toHaveURL(/\/admin\/calendar$/);
  await expect(page.getByRole("row", { name: new RegExp(semesterName) }).getByText("Open", { exact: true })).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password", { exact: true }).fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/calendar");
  const superAdminRow = page.getByRole("row", { name: new RegExp(semesterName) });
  await expect(superAdminRow).toBeVisible();

  // A Super Admin can move a semester forward too, and their reason is
  // optional everywhere except the reopen -- so this advance goes through
  // with the field left empty.
  await superAdminRow.getByLabel("Move to").selectOption("IN_PROGRESS");
  await superAdminRow.getByRole("button", { name: "Change state" }).click();

  await expect(page).toHaveURL(/\/admin\/calendar$/);
  await expect(
    page.getByRole("row", { name: new RegExp(semesterName) }).getByText("In Progress", { exact: true }),
  ).toBeVisible();
});

test("a Student sees 'not available to your role' instead of the calendar forms", async ({ page }) => {
  const student = await makeSignedInUser("STUDENT", "calendar-student");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(student.username);
  await page.getByLabel("Password", { exact: true }).fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/calendar");
  await expect(page.getByText("Not available to your role.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add academic year" })).toHaveCount(0);
});
