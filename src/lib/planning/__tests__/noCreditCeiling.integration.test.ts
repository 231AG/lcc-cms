import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicYear,
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  semester,
  student,
} from "@/lib/db/schema";
import { ValidationError } from "@/lib/errors";
import { getPlanValidation, submitPlan } from "../planning";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * There is no credit-hour ceiling on a plan.
 *
 * The case this pins is the one that reached production: a department
 * whose ceiling was set to 1 refused every plan its students submitted
 * with "This plan totals 16 credit hours; the maximum is 1." A plan of any
 * size now submits, and the Admin approves or rejects it; only an empty
 * plan is still refused.
 *
 * Direct inserts with synthetic ids, like enrolmentCounts.integration.test.ts,
 * so this runs in CI without a Supabase project.
 */

const id = () => randomUUID();
const ADMIN = id(), STUDENT = id(), EMPTY_STUDENT = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id();
const COURSES = [id(), id(), id(), id()];
const OFFERINGS = [id(), id(), id(), id()];
const PLAN = id(), EMPTY_PLAN = id();
const tag = ADMIN.slice(0, 6);
// Unique per run: the two students are left behind by design (see
// afterAll), so a fixed Student ID would collide on the next run. Eight
// digits, matching student_number's CHECK '^(19|20)[0-9]{2}[0-9]{2,4}$'.
const seq = Date.now() % 9000;
const HEAVY_NO = `2019${String(1000 + seq).padStart(4, "0")}`;
const EMPTY_NO = `2019${String(1001 + seq).padStart(4, "0")}`;

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "t", mustChangePassword: false }) as Actor;

describe("no credit-hour ceiling on a plan", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: STUDENT, loginIdentifier: HEAVY_NO, displayName: "Heavy", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: EMPTY_STUDENT, loginIdentifier: EMPTY_NO, displayName: "Empty", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `NC-${tag}`, name: "Ceiling College", isActive: true });
    // The production shape: a department ceiling of 1.
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: `NCD${tag.slice(0, 3)}`, name: "Ceiling Dept", isActive: true, maxCreditsOverride: 1 });
    await db.insert(student).values([
      { id: STUDENT, studentNumber: HEAVY_NO, firstName: "Jason", lastName: "Steronson", departmentId: DEPT, enrolmentYear: 2019, historicalImportStatus: "COMPLETE", createdBy: ADMIN },
      { id: EMPTY_STUDENT, studentNumber: EMPTY_NO, firstName: "Empty", lastName: "Plan", departmentId: DEPT, enrolmentYear: 2019, historicalImportStatus: "COMPLETE", createdBy: ADMIN },
    ]);
    await db.insert(academicYear).values({ id: YEAR, label: `NC-${tag}`, startDate: "2031-09-01", endDate: "2032-06-30", isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2031-09-01", endDate: "2032-01-15" });
    // Four 4-credit courses: 16 credit hours, as in the report.
    for (let i = 0; i < 4; i++) {
      await db.insert(course).values({ id: COURSES[i], departmentId: DEPT, code: `NC${tag.slice(0, 3)}${i}`, title: `Course ${i}`, creditHours: 4, isActive: true });
      await db.insert(courseOffering).values({ id: OFFERINGS[i], courseId: COURSES[i], semesterId: SEM, section: "1", capacity: 30, status: "PUBLISHED", frozenCreditHours: 4 });
    }
    await db.insert(coursePlan).values([
      { id: PLAN, studentId: STUDENT, semesterId: SEM, status: "DRAFT", totalCredits: 16 },
      { id: EMPTY_PLAN, studentId: EMPTY_STUDENT, semesterId: SEM, status: "DRAFT", totalCredits: 0 },
    ]);
    await db.insert(coursePlanItem).values(
      COURSES.map((courseId, i) => ({ id: id(), planId: PLAN, offeringId: OFFERINGS[i], courseId, status: "PENDING" })),
    );
  });

  afterAll(async () => {
    // Best effort: the audit rows submitPlan writes hold RESTRICT keys to
    // the users, so those two stay behind -- harmless synthetic rows.
    const quiet = (p: Promise<unknown>) => p.catch(() => {});
    await quiet(db.delete(coursePlanItem).where(inArray(coursePlanItem.planId, [PLAN, EMPTY_PLAN])));
    await quiet(db.delete(coursePlan).where(inArray(coursePlan.id, [PLAN, EMPTY_PLAN])));
    await quiet(db.delete(courseOffering).where(inArray(courseOffering.id, OFFERINGS)));
    await quiet(db.delete(course).where(inArray(course.id, COURSES)));
    await quiet(db.delete(semester).where(eq(semester.id, SEM)));
    await quiet(db.delete(academicYear).where(eq(academicYear.id, YEAR)));
    await quiet(db.delete(student).where(inArray(student.id, [STUDENT, EMPTY_STUDENT])));
    await quiet(db.delete(departmentTable).where(eq(departmentTable.id, DEPT)));
    await quiet(db.delete(collegeTable).where(eq(collegeTable.id, COLLEGE)));
    await quiet(db.delete(appUser).where(inArray(appUser.id, [ADMIN, STUDENT, EMPTY_STUDENT])));
  });

  it("the review check raises no credit-hour issue for a 16-credit plan under a ceiling of 1", async () => {
    const result = await getPlanValidation(actorOf(ADMIN, "ADMIN"), PLAN);
    const all = [...result.blocking, ...result.warnings];
    expect(all.filter((i) => /credit hours|maximum/i.test(i.message))).toEqual([]);
    expect(result.blocking).toEqual([]);
  });

  it("the student can submit it, and it goes to the Admin to decide", async () => {
    const { plan } = await submitPlan(actorOf(STUDENT, "STUDENT"), PLAN);
    expect(plan.status).toBe("SUBMITTED");
  });

  it("an empty plan is still refused", async () => {
    await expect(submitPlan(actorOf(EMPTY_STUDENT, "STUDENT"), EMPTY_PLAN)).rejects.toThrow(ValidationError);
  });
});
