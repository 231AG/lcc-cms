import { describe, expect, it, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount, disableAccount, enableAccount } from "../accounts";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * createStaffAccount records `created_by`, which is a real (RESTRICT) FK
 * to app_user.id -- a fabricated actor id is correctly refused by the
 * database, as caught while first writing this suite. Using the real
 * bootstrap Super Admin's row satisfies that constraint without this suite
 * needing to create its own Super Admin fixture just to act as `actor`.
 */
async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to act as the test's actor.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

/**
 * Exercises the real service path (Section 23.3), not just the permission
 * kernel in isolation: a Student or an Admin attempting to create a staff
 * account must be refused by createStaffAccount() itself, and the
 * min-one-active-Super-Admin invariant must hold through disableAccount()
 * as a friendly StateError, not just as a raw trigger exception.
 */

const createdUserIds: string[] = [];

async function cleanupUser(userId: string) {
  // Never hard-deleted: creating an account writes a USER_CREATED audit
  // entry immediately, and audit_log -> app_user is RESTRICT (Section 9.5).
  await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, userId));
  await createAdminClient()
    .auth.admin.deleteUser(userId)
    .catch(() => {});
}

afterAll(async () => {
  await Promise.all(createdUserIds.map(cleanupUser));
});

const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };
const adminActor: Actor = { userId: "00000000-0000-0000-0000-000000000002", role: "ADMIN" };

describe("createStaffAccount", () => {
  it("refuses a Student", async () => {
    await expect(
      createStaffAccount({
        actor: studentActor,
        username: `test-refuse-${Date.now()}`,
        displayName: "Should Not Exist",
        role: "ADMIN",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses an Admin (REQ-A06: Super Admin only)", async () => {
    await expect(
      createStaffAccount({
        actor: adminActor,
        username: `test-refuse-${Date.now()}`,
        displayName: "Should Not Exist",
        role: "ADMIN",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows a Super Admin to create an Admin account, audited", async () => {
    const superAdminActor = await realSuperAdminActor();
    const username = `test-created-${Date.now()}`;

    const result = await createStaffAccount({
      actor: superAdminActor,
      username,
      displayName: "Test Created Admin",
      role: "ADMIN",
    });

    expect(result.username).toBe(username);
    expect(result.temporaryPassword.length).toBeGreaterThan(10);

    const row = await db.query.appUser.findFirst({
      where: eq(appUser.loginIdentifier, username),
    });
    expect(row?.role).toBe("ADMIN");
    expect(row?.mustChangePassword).toBe(true);
    if (row) createdUserIds.push(row.id);
  });

  it("rejects a duplicate username with a clear error, not a duplicate account", async () => {
    const superAdminActor = await realSuperAdminActor();
    const username = `test-dup-${Date.now()}`;

    const first = await createStaffAccount({
      actor: superAdminActor,
      username,
      displayName: "First",
      role: "ADMIN",
    });
    const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
    if (row) createdUserIds.push(row.id);
    expect(first.username).toBe(username);

    await expect(
      createStaffAccount({
        actor: superAdminActor,
        username,
        displayName: "Second",
        role: "ADMIN",
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("disableAccount / enableAccount", () => {
  it("refuses an Admin (Super Admin only)", async () => {
    await expect(disableAccount(adminActor, "00000000-0000-0000-0000-000000000099")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(enableAccount(adminActor, "00000000-0000-0000-0000-000000000099")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("lets a Super Admin disable and re-enable a non-Super-Admin account", async () => {
    const superAdminActor = await realSuperAdminActor();
    const username = `test-disable-${Date.now()}`;

    const result = await createStaffAccount({
      actor: superAdminActor,
      username,
      displayName: "To Be Disabled",
      role: "ADMIN",
    });
    const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, result.username) });
    if (!row) throw new Error("fixture setup failed");
    createdUserIds.push(row.id);

    await disableAccount(superAdminActor, row.id);
    let updated = await db.query.appUser.findFirst({ where: eq(appUser.id, row.id) });
    expect(updated?.status).toBe("DISABLED");

    await enableAccount(superAdminActor, row.id);
    updated = await db.query.appUser.findFirst({ where: eq(appUser.id, row.id) });
    expect(updated?.status).toBe("ACTIVE");
  });

  // The "last active Super Admin" invariant itself (I-11) is verified at
  // the database layer in identity_rls.integration.test.ts, using a
  // transaction that never commits. Reproducing that here through
  // disableAccount() would require temporarily disabling every OTHER
  // active Super Admin in this shared database -- including the real
  // bootstrap account -- which is not a risk worth taking in an automated
  // suite. disableAccount()'s friendly pre-check (a StateError with a
  // clear message, rather than a raw trigger exception surfacing to the
  // Super Admin using X-04) is exercised manually instead.
});
