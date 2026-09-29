import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { appUser, auditLog, college as collegeTable, department as departmentTable, student } from "@/lib/db/schema";
import { issueLoginSlips, listLoginSlipStudents, MAX_SLIPS_PER_PRINT } from "../loginSlips";
import { TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_LENGTH } from "../temporaryPassword";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Login slips against a real database, with the Auth service swapped for a
 * recorder: who is listed where, that printing issues a fresh password,
 * puts the student back on "change at first sign-in" and audits it, that
 * one failure does not lose the others, and that nothing stores a password.
 */

const id = () => randomUUID();
const ADMIN = id(), SUPER = id(), NEW_STU = id(), CHANGED_STU = id(), DISABLED_STU = id();
const COLLEGE = id(), DEPT = id();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const n = String(Date.now() % 100000).padStart(5, "0");
const NUM = { fresh: `19${n}1`, changed: `19${n}2`, disabled: `19${n}3` };
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;
const superAdmin = { userId: SUPER, role: "SUPER_ADMIN", displayName: "s", mustChangePassword: false } as unknown as Actor;

describe("login slips", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `slips-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: SUPER, loginIdentifier: `slips-${SUPER}@lcc.edu`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: NEW_STU, loginIdentifier: NUM.fresh, displayName: "New", role: "STUDENT", status: "ACTIVE", mustChangePassword: true },
      { id: CHANGED_STU, loginIdentifier: NUM.changed, displayName: "Changed", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: DISABLED_STU, loginIdentifier: NUM.disabled, displayName: "Off", role: "STUDENT", status: "DISABLED", mustChangePassword: true },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `SL-${tag}`, name: "Slip College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `SLP${tag}`, name: `Slip Dept ${tag}`, isActive: true });
    await db.insert(student).values([
      { id: NEW_STU, studentNumber: NUM.fresh, firstName: "Abraham", lastName: "Kollie", departmentId: DEPT, enrolmentYear: 2025, createdBy: ADMIN },
      { id: CHANGED_STU, studentNumber: NUM.changed, firstName: "Onesmus", middleName: "L.", lastName: "Carr", departmentId: DEPT, enrolmentYear: 2025, createdBy: ADMIN },
      { id: DISABLED_STU, studentNumber: NUM.disabled, firstName: "Gone", lastName: "Away", departmentId: DEPT, enrolmentYear: 2025, createdBy: ADMIN },
    ]);
  });

  afterAll(async () => {
    // Students, users and audit rows stay: the audit rows hold RESTRICT keys
    // to them, and they are harmless synthetic rows.
    await db.update(appUser).set({ status: "DISABLED" }).where(inArray(appUser.id, [NEW_STU, CHANGED_STU])).catch(() => {});
  });

  it("lists active students on the tab they belong to, never a disabled one", async () => {
    const list = (await listLoginSlipStudents(admin)).filter((s) => s.departmentName === `Slip Dept ${tag}`);
    expect(list.map((s) => [s.studentNumber, s.passwordChanged])).toEqual([
      [NUM.changed, true],
      [NUM.fresh, false],
    ]);
  });

  it("is the Admin's alone, like any password reset", async () => {
    await expect(listLoginSlipStudents(superAdmin)).rejects.toThrow();
    await expect(issueLoginSlips(superAdmin, [NEW_STU], async () => {})).rejects.toThrow();
  });

  it("issues a fresh password per student, puts them back on change-at-first-sign-in, and audits it", async () => {
    const set: Array<[string, string]> = [];
    const r = await issueLoginSlips(admin, [NEW_STU, CHANGED_STU], async (uid, pw) => void set.push([uid, pw]));
    expect(r.failed).toEqual([]);
    expect(r.slips.map((s) => [s.studentNumber, s.name])).toEqual([
      [NUM.fresh, "Abraham Kollie"],
      [NUM.changed, "Onesmus L. Carr"],
    ]);
    for (const s of r.slips) {
      expect(s.temporaryPassword).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect([...s.temporaryPassword].every((c) => TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true);
      // The password printed is exactly the one given to the Auth service.
      expect(set).toContainEqual([s.studentId, s.temporaryPassword]);
    }
    const changed = await db.query.appUser.findFirst({ where: eq(appUser.id, CHANGED_STU) });
    expect(changed?.mustChangePassword).toBe(true);

    const audits = await db.query.auditLog.findMany({ where: and(eq(auditLog.actorUserId, ADMIN), eq(auditLog.action, "LOGIN_SLIP_ISSUED")) });
    expect(audits).toHaveLength(2);
    // The log records that a slip went out -- never the password.
    for (const a of audits) expect(JSON.stringify(a)).not.toMatch(new RegExp(r.slips.map((s) => s.temporaryPassword).join("|")));
  });

  it("keeps every password that was set when another student fails", async () => {
    const r = await issueLoginSlips(admin, [NEW_STU, CHANGED_STU], async (uid) => {
      if (uid === CHANGED_STU) throw new Error("Auth service unavailable");
    });
    expect(r.slips.map((s) => s.studentNumber)).toEqual([NUM.fresh]);
    expect(r.failed).toEqual([{ studentNumber: NUM.changed, name: "Onesmus L. Carr", reason: "Auth service unavailable" }]);
  });

  it("refuses a disabled account, an empty print, and an oversized one", async () => {
    await expect(issueLoginSlips(admin, [DISABLED_STU], async () => {})).rejects.toThrow(/no longer has an active account/);
    await expect(issueLoginSlips(admin, [], async () => {})).rejects.toThrow(/at least one/);
    await expect(issueLoginSlips(admin, Array.from({ length: MAX_SLIPS_PER_PRINT + 1 }, id), async () => {})).rejects.toThrow(/at most/);
  });
});
