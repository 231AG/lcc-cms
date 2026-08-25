import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../src/lib/supabase/admin";
import { db } from "../src/lib/db/client";
import { appUser } from "../src/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "../src/lib/identity/resolve";

/**
 * Real end-to-end verification of the login -> forced password change ->
 * authenticated session loop (REQ-A01, REQ-A03), driven through an actual
 * browser against the real (shared dev/staging/prod, per DEV-01) Supabase
 * project -- this is what a curl-based test cannot do, because Next.js
 * Server Actions require the browser's own form-encoding handshake.
 */

// Unique per run: app_user rows are never hard-deleted once they've done
// anything audited (the FK from audit_log to app_user is RESTRICT, by
// design -- Section 9.5), so a fixed username would collide with the
// previous run's now-undeletable row and its already-registered Auth email.
const TEST_USERNAME = `e2e-test-admin-${Date.now()}`;
const TEST_EMAIL = resolveLoginIdentifierToEmail(TEST_USERNAME);
const TEMP_PASSWORD = "TempPass12345!";
const NEW_PASSWORD = "NewPassword98765!";

let testUserId: string;

test.beforeAll(async () => {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create test Auth user: ${error?.message}`);
  }
  testUserId = data.user.id;

  await db.insert(appUser).values({
    id: testUserId,
    loginIdentifier: TEST_USERNAME,
    displayName: "E2E Test Admin",
    role: "ADMIN",
    status: "ACTIVE",
    mustChangePassword: true,
  });
});

test.afterAll(async () => {
  if (!testUserId) return;
  // Disable, don't delete: once the test performs an audited action (e.g.
  // changing its own password), audit_log.actor_user_id -> app_user.id is
  // RESTRICT, so a hard delete would fail -- and per Section 9.5, app_user
  // rows are never hard-deleted anyway. Best-effort Auth cleanup so the
  // Supabase project doesn't accumulate test accounts indefinitely.
  await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, testUserId));
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(testUserId).catch(() => {
    /* best-effort; a leftover disabled test Auth user is harmless */
  });
});

test("forced password change cannot be bypassed by navigating straight to /portal", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(TEST_USERNAME);
  await page.getByLabel("Password").fill(TEMP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/change-password$/);

  // REQ-A03: unbypassable by direct URL.
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();

  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText("E2E Test Admin")).toBeVisible();
  await expect(page.getByText("ADMIN", { exact: true })).toBeVisible();
});

test("wrong password shows a generic error, not which field was wrong", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Student ID or Username").fill(TEST_USERNAME);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/login\?error=1$/);
  await expect(
    page.getByText("Student ID/username or password is incorrect."),
  ).toBeVisible();
});
