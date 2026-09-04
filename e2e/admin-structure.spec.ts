import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser, college } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";

/**
 * A-02..A-05 (plan Section 20.4): an Admin manages the academic structure;
 * a Student sees "not available to your role" instead of the forms.
 */

const PASSWORD = "TestPassword12345!";
const cleanupIds: string[] = [];

async function makeSignedInUser(role: "ADMIN" | "STUDENT", label: string) {
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

  cleanupIds.push(data.user.id);
  return { username, password: PASSWORD };
}

test.afterAll(async () => {
  for (const id of cleanupIds) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, id));
    await createAdminClient().auth.admin.deleteUser(id).catch(() => {});
  }
});

test("Admin can create a college and gets a clear error on a duplicate code", async ({ page }) => {
  const admin = await makeSignedInUser("ADMIN", "structure-admin");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/structure");
  await expect(page.getByRole("heading", { name: "Academic structure" })).toBeVisible();

  const code = `E2E${Date.now()}`;
  await page.getByLabel("Code", { exact: true }).first().fill(code);
  await page.getByLabel("Name", { exact: true }).first().fill("E2E Test College");
  await page.getByRole("button", { name: "Add college" }).click();

  await expect(page).toHaveURL(/\/admin\/structure$/);
  await expect(page.getByRole("cell", { name: code, exact: true })).toBeVisible();

  const created = await db.query.college.findFirst({ where: eq(college.code, code) });

  // Duplicate code, different case: must be refused with a clear message,
  // not a raw database error (Section 21.6).
  await page.getByLabel("Code", { exact: true }).first().fill(code.toLowerCase());
  await page.getByLabel("Name", { exact: true }).first().fill("Different Name");
  await page.getByRole("button", { name: "Add college" }).click();

  await expect(page.getByText(/already exists/i)).toBeVisible();

  if (created) await db.delete(college).where(eq(college.id, created.id));
});

test("a Student sees 'not available to your role' instead of the structure forms", async ({ page }) => {
  const student = await makeSignedInUser("STUDENT", "structure-student");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(student.username);
  await page.getByLabel("Password", { exact: true }).fill(student.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/structure");
  await expect(page.getByText("Not available to your role.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add college" })).toHaveCount(0);
});
