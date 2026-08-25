import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";

/**
 * X-04 (plan Section 20.5): Super Admin creates/disables/enables staff
 * accounts; an Admin sees "not available to your role" instead of the form.
 */

const PASSWORD = "TestPassword12345!";
const cleanupIds: string[] = [];

async function makeSignedInUser(role: "ADMIN" | "SUPER_ADMIN", label: string) {
  const username = `e2e-${label}-${Date.now()}`;
  const email = resolveLoginIdentifierToEmail(username);
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`setup failed: ${error?.message}`);

  await db.insert(appUser).values({
    id: data.user.id,
    loginIdentifier: username,
    displayName: `E2E ${label}`,
    role,
    status: "ACTIVE",
    mustChangePassword: false, // skip the forced-change flow, already covered by auth.spec.ts
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

test("Super Admin can create, disable, and re-enable a staff account", async ({ page }) => {
  const superAdmin = await makeSignedInUser("SUPER_ADMIN", "super");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(superAdmin.username);
  await page.getByLabel("Password").fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "Admin accounts" })).toBeVisible();

  const newUsername = `e2e-created-${Date.now()}`;
  await page.getByLabel("Username").fill(newUsername);
  await page.getByLabel("Display name").fill("Newly Created Admin");
  await page.getByLabel("Role").selectOption("ADMIN");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Account created.")).toBeVisible();
  // Two matches for the username exist on the page (the success message's
  // <code> and the table row) -- scope to the table cell specifically.
  await expect(page.getByRole("cell", { name: newUsername, exact: true })).toBeVisible();

  // Track for cleanup.
  const created = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, newUsername) });
  if (created) cleanupIds.push(created.id);

  const row = page.locator("tr", { hasText: newUsername });
  await expect(row.getByText("ACTIVE")).toBeVisible();

  await row.getByRole("button", { name: "Disable" }).click();
  await expect(page).toHaveURL(/\/admin\/accounts$/);
  const rowAfterDisable = page.locator("tr", { hasText: newUsername });
  await expect(rowAfterDisable.getByText("DISABLED")).toBeVisible();

  await rowAfterDisable.getByRole("button", { name: "Enable" }).click();
  const rowAfterEnable = page.locator("tr", { hasText: newUsername });
  await expect(rowAfterEnable.getByText("ACTIVE")).toBeVisible();
});

test("an Admin sees 'not available to your role' instead of the account form", async ({ page }) => {
  const admin = await makeSignedInUser("ADMIN", "plain");

  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/admin/accounts");
  await expect(page.getByText("Not available to your role.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
});
