import { describe, expect, it } from "vitest";
import { assertCan, can } from "@/lib/permissions/kernel";
import { ForbiddenError } from "@/lib/errors";

/**
 * Exercises assertCan against the real seeded permission table (plan
 * Section 23.3: "every forbidden action is tested"). This suite grows with
 * the permission matrix -- adding a row to db/seed.ts's PERMISSIONS_STAGE_2
 * (or a future stage's set) should come with a positive and a negative case
 * here (Section 23.8).
 */
describe("assertCan (Section 11 permission kernel)", () => {
  it("allows an Admin to create a student account", async () => {
    await expect(
      assertCan({ userId: "x", role: "ADMIN" }, "identity.createStudentAccount"),
    ).resolves.toBeUndefined();
  });

  it("refuses a Super Admin from creating a student account (REQ-R04)", async () => {
    await expect(
      assertCan({ userId: "x", role: "SUPER_ADMIN" }, "identity.createStudentAccount"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a Student from creating a student account", async () => {
    await expect(
      assertCan({ userId: "x", role: "STUDENT" }, "identity.createStudentAccount"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows only Super Admin to create a staff account (REQ-A06)", async () => {
    await expect(can({ userId: "x", role: "SUPER_ADMIN" }, "identity.createStaffAccount")).resolves.toBe(true);
    await expect(can({ userId: "x", role: "ADMIN" }, "identity.createStaffAccount")).resolves.toBe(false);
    await expect(can({ userId: "x", role: "STUDENT" }, "identity.createStaffAccount")).resolves.toBe(false);
  });

  it("allows every role to change their own password", async () => {
    for (const role of ["STUDENT", "ADMIN", "SUPER_ADMIN"] as const) {
      await expect(can({ userId: "x", role }, "identity.changePassword")).resolves.toBe(true);
    }
  });

  it("denies by default for an action with no permission row at all", async () => {
    await expect(
      assertCan({ userId: "x", role: "SUPER_ADMIN" }, "nonexistent.action"),
    ).rejects.toThrow(ForbiddenError);
  });
});
