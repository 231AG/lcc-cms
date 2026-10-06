import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { appUser, college as collegeTable, department as departmentTable, student, studentCumulativeSummary } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions/kernel";
import { getStudentLevels } from "@/lib/gpa/gpa";
import { getStudentStatistics } from "@/lib/dashboard/statistics";
import { searchStudents } from "../students";

/**
 * A student's Status is their level, worked out from earned credit hours:
 * the lookup the screens use, and the listing's Status filter, which has to
 * agree with it -- including for a student with no record yet (Freshman).
 *
 * Direct inserts with synthetic ids, so this runs in CI without Supabase.
 */

const ADMIN = randomUUID(), COLLEGE = randomUUID(), DEPT = randomUUID();
const NEW = randomUUID(), SOPH = randomUUID(), JUNIOR = randomUUID(), SENIOR = randomUUID();
const ids = [NEW, SOPH, JUNIOR, SENIOR];
const tag = ADMIN.replace(/[^a-f]/g, "").slice(0, 4).toUpperCase().padEnd(4, "Q");
const admin = { userId: ADMIN, role: "ADMIN", displayName: "t", mustChangePassword: false } as unknown as Actor;
const no = (i: number) => `2018${String((Date.now() + i * 7) % 1000).padStart(3, "0")}${i}`;

describe("student level (Status)", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `lvl-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      ...ids.map((id, i) => ({ id, loginIdentifier: no(i), displayName: "S", role: "STUDENT", status: "ACTIVE", mustChangePassword: false })),
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `LV-${tag}`, name: "Level College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `LVL${tag}`, name: "Level Dept", isActive: true });
    await db.insert(student).values(
      ids.map((id, i) => ({ id, studentNumber: no(i), firstName: "Lev", lastName: `${tag}${i}`, departmentId: DEPT, enrolmentYear: 2018, createdBy: ADMIN })),
    );
    // NEW has no summary at all; the rest sit exactly on a cut-off.
    await db.insert(studentCumulativeSummary).values(
      [
        [SOPH, "33.0"],
        [JUNIOR, "98.0"],
        [SENIOR, "99.0"],
      ].map(([studentId, earned]) => ({
        studentId, totalCreditsAttempted: earned, totalCreditsEarned: earned, isProvisional: false, policyVersion: 1,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(studentCumulativeSummary).where(inArray(studentCumulativeSummary.studentId, ids)).catch(() => {});
  });

  it("works each level out from earned credit hours", async () => {
    const levels = await getStudentLevels(admin, ids);
    expect(ids.map((id) => levels.get(id))).toEqual(["FRESHMAN", "SOPHOMORE", "JUNIOR", "SENIOR"]);
  });

  it("filters the listing by level, agreeing with the lookup", async () => {
    const lastNames = async (level: "FRESHMAN" | "SOPHOMORE" | "JUNIOR" | "SENIOR") =>
      (await searchStudents(admin, { query: tag, level })).rows.map((r) => r.lastName);
    expect(await lastNames("FRESHMAN")).toEqual([`${tag}0`]);
    expect(await lastNames("SOPHOMORE")).toEqual([`${tag}1`]);
    expect(await lastNames("JUNIOR")).toEqual([`${tag}2`]);
    expect(await lastNames("SENIOR")).toEqual([`${tag}3`]);
  });

  it("counts the dashboard's students by level, Freshman to Senior, adding up to the total", async () => {
    const stats = await getStudentStatistics(admin);
    expect(stats.byLevel.map((l) => l.label)).toEqual(["Freshman", "Sophomore", "Junior", "Senior"]);
    expect(stats.byLevel.reduce((sum, l) => sum + l.count, 0)).toBe(stats.total);
    expect(stats.byLevel.every((l) => l.count >= 1)).toBe(true);
  });
});
