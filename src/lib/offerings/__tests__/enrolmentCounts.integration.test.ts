import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
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
  registration,
  semester,
  student,
} from "@/lib/db/schema";
import { getOfferingRows } from "../offeringRows";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * The Enrolled column, read by each role.
 *
 * This exists because of one specific trap. Row-level security on
 * `registration` is "your own rows, or ADMIN":
 *
 *     USING (current_user_role() = 'ADMIN' OR student_id = auth.uid())
 *
 * so a count taken the ordinary way -- through asUser, like every other read
 * on that page -- gives a student their own registrations only, and gives a
 * SUPER_ADMIN nothing at all, because that policy names ADMIN and not the
 * role above it. Three readers, three different wrong numbers, none of them
 * an error anyone would notice.
 *
 * So all three roles are asserted here, not just the convenient one. If
 * someone later "tidies" the count onto asUser, two of these fail.
 */

const id = () => randomUUID();
const SUPER = id(), ADMIN = id(), S1 = id(), S2 = id(), S3 = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id();
const COURSE_FULL = id(), COURSE_EMPTY = id();
const OFF_FULL = id(), OFF_EMPTY = id();
const PLAN_SUBMITTED = id(), PLAN_DRAFT = id();

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "t", mustChangePassword: false }) as Actor;

describe("enrolment counts on the offerings table", () => {
  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: S1, loginIdentifier: "20267701", displayName: "One", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: S2, loginIdentifier: "20267702", displayName: "Two", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
      { id: S3, loginIdentifier: "20267703", displayName: "Three", role: "STUDENT", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `EC-${COLLEGE.slice(0, 6)}`, name: "Enrolment College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: "ENRL", name: "Enrolment Dept", isActive: true });
    // 8 digits: student_number is CHECK ~ '^(19|20)[0-9]{2}[0-9]{2,4}$'.
    for (const [sid, num] of [[S1, "20267701"], [S2, "20267702"], [S3, "20267703"]] as const) {
      await db.insert(student).values({
        id: sid, studentNumber: num, firstName: "Test", lastName: "Student",
        departmentId: DEPT, enrolmentYear: 2026, status: "ACTIVE", historicalImportStatus: "COMPLETE", createdBy: SUPER,
      });
    }
    await db.insert(academicYear).values({ id: YEAR, label: `ENRL-${YEAR.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" });
    await db.insert(course).values([
      { id: COURSE_FULL, departmentId: DEPT, code: `ENRL${COURSE_FULL.slice(0, 3)}`, title: "Busy Course", creditHours: 3, isActive: true },
      { id: COURSE_EMPTY, departmentId: DEPT, code: `ENRL${COURSE_EMPTY.slice(0, 3)}`, title: "Quiet Course", creditHours: 3, isActive: true },
    ]);
    await db.insert(courseOffering).values([
      { id: OFF_FULL, courseId: COURSE_FULL, semesterId: SEM, section: "A", capacity: 10, status: "PUBLISHED", frozenCreditHours: 3 },
      { id: OFF_EMPTY, courseId: COURSE_EMPTY, semesterId: SEM, section: "A", capacity: 10, status: "PUBLISHED", frozenCreditHours: 3 },
    ]);

    // Two students hold a seat in the busy course.
    await db.insert(registration).values([
      { id: id(), studentId: S1, offeringId: OFF_FULL, semesterId: SEM, status: "REGISTERED", source: "ADMIN_DIRECT", frozenCreditHours: 3 },
      { id: id(), studentId: S2, offeringId: OFF_FULL, semesterId: SEM, status: "REGISTERED", source: "ADMIN_DIRECT", frozenCreditHours: 3 },
    ]);

    // A third has asked for one and is waiting on a decision.
    await db.insert(coursePlan).values({ id: PLAN_SUBMITTED, studentId: S3, semesterId: SEM, status: "SUBMITTED", totalCredits: 3 });
    await db.insert(coursePlanItem).values({ id: id(), planId: PLAN_SUBMITTED, offeringId: OFF_FULL, courseId: COURSE_FULL, status: "PENDING" });

    // And one is still deciding -- a DRAFT plan claims nothing, so this must
    // NOT be counted.
    await db.insert(coursePlan).values({ id: PLAN_DRAFT, studentId: S1, semesterId: SEM, status: "DRAFT", totalCredits: 3 });
    await db.insert(coursePlanItem).values({ id: id(), planId: PLAN_DRAFT, offeringId: OFF_EMPTY, courseId: COURSE_EMPTY, status: "PENDING" });
  });

  afterAll(async () => {
    await db.delete(coursePlanItem).where(inArray(coursePlanItem.planId, [PLAN_SUBMITTED, PLAN_DRAFT]));
    await db.delete(coursePlan).where(inArray(coursePlan.id, [PLAN_SUBMITTED, PLAN_DRAFT]));
    await db.delete(registration).where(inArray(registration.offeringId, [OFF_FULL, OFF_EMPTY]));
    await db.delete(courseOffering).where(inArray(courseOffering.id, [OFF_FULL, OFF_EMPTY]));
    await db.delete(course).where(inArray(course.id, [COURSE_FULL, COURSE_EMPTY]));
    await db.delete(semester).where(inArray(semester.id, [SEM]));
    await db.delete(academicYear).where(inArray(academicYear.id, [YEAR]));
    await db.delete(student).where(inArray(student.id, [S1, S2, S3]));
    await db.delete(departmentTable).where(inArray(departmentTable.id, [DEPT]));
    await db.delete(collegeTable).where(inArray(collegeTable.id, [COLLEGE]));
    // SUPER is left behind: the trigger that keeps at least one active Super
    // Admin forbids deleting the last one, and this suite does not own it.
    await db.delete(appUser).where(inArray(appUser.id, [ADMIN, S1, S2, S3]));
  });

  const countsFor = async (actor: Actor, offeringId: string) => {
    const rows = await getOfferingRows(actor, SEM);
    const row = rows.find((r) => r.offeringId === offeringId);
    expect(row, "the offering should be on the page").toBeTruthy();
    return { enrolled: row!.enrolled, pending: row!.pending, capacity: row!.capacity };
  };

  it("an ADMIN sees every seat taken and every one claimed", async () => {
    expect(await countsFor(actorOf(ADMIN, "ADMIN"), OFF_FULL)).toEqual({ enrolled: "2", pending: "1", capacity: "10" });
  });

  it("a SUPER_ADMIN sees the same numbers, though RLS would give it none", async () => {
    expect(await countsFor(actorOf(SUPER, "SUPER_ADMIN"), OFF_FULL)).toEqual({ enrolled: "2", pending: "1", capacity: "10" });
  });

  it("a STUDENT sees the same numbers, not just their own row", async () => {
    // S3 is registered for nothing: counted through RLS this would read 0.
    expect(await countsFor(actorOf(S3, "STUDENT"), OFF_FULL)).toEqual({ enrolled: "2", pending: "1", capacity: "10" });
  });

  it("a DRAFT plan claims no seat", async () => {
    expect(await countsFor(actorOf(ADMIN, "ADMIN"), OFF_EMPTY)).toEqual({ enrolled: "0", pending: "0", capacity: "10" });
  });
});
