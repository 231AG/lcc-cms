import { describe, expect, it, beforeAll } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { appUser, auditLog, college as collegeTable, department as departmentTable, student } from "@/lib/db/schema";
import { ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { updateStudentProfile } from "../students";

/**
 * The optional transcript details on a student record (migration 0034):
 * saved trimmed, cleared by a blank, left alone when not sent, dates
 * checked, and every change in the audit trail.
 *
 * Direct inserts with synthetic ids, so this runs in CI without a Supabase
 * project -- none of these edits touch the sign-in account.
 */

const ADMIN = randomUUID(), STU = randomUUID(), COLLEGE = randomUUID(), DEPT = randomUUID();
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const STUDENT_NO = `2019${String(Date.now() % 1000).padStart(3, "0")}`;
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;

const reload = () => db.query.student.findFirst({ where: eq(student.id, STU) });

describe("student transcript details", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `det-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STU, loginIdentifier: STUDENT_NO, displayName: "Ruth", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `DT-${tag}`, name: "Details College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `DET${tag}`, name: "Details Dept", isActive: true });
    await db.insert(student).values({
      id: STU, studentNumber: STUDENT_NO, firstName: "Ruth", lastName: `Doe${tag}`, departmentId: DEPT, enrolmentYear: 2019, createdBy: ADMIN,
    });
  });

  it("saves the details trimmed, and records the change", async () => {
    await updateStudentProfile(admin, STU, {
      details: { dateOfBirth: "2000-02-29", address: "  Sinkor, Monrovia ", degree: "BA", acceptedFrom: "" },
    });
    expect(await reload()).toMatchObject({ dateOfBirth: "2000-02-29", address: "Sinkor, Monrovia", degree: "BA", acceptedFrom: null });

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, STU), eq(auditLog.action, "STUDENT_UPDATED")))
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);
    expect(entry.newValue).toEqual({ dateOfBirth: "2000-02-29", address: "Sinkor, Monrovia", degree: "BA" });
  });

  it("leaves a detail that was not sent as it is, and clears one sent blank", async () => {
    await updateStudentProfile(admin, STU, { details: { address: "" } });
    expect(await reload()).toMatchObject({ dateOfBirth: "2000-02-29", address: null, degree: "BA" });
  });

  it("refuses a date that is not a real day, and a value too long to print", async () => {
    await expect(updateStudentProfile(admin, STU, { details: { graduationDate: "2023-02-30" } })).rejects.toThrow(
      new ValidationError("Date of graduation must be a real date."),
    );
    await expect(updateStudentProfile(admin, STU, { details: { parentGuardian: "x".repeat(121) } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await reload()).toMatchObject({ graduationDate: null, parentGuardian: null });
  });
});
