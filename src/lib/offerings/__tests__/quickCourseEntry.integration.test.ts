import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  appUser,
  academicYear,
  auditLog,
  college as collegeTable,
  course,
  courseOffering,
  department as departmentTable,
  offeringMeeting,
  semester,
} from "@/lib/db/schema";
import { createOffering, UnknownCourseCodeError } from "../offerings";
import { ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Creating a course from the Add-an-offering form.
 *
 * The registrar's most repeated task was leaving this screen for Academic
 * structure to add one course and coming straight back. Doing it here
 * removes four screens and adds one danger: a mistyped code becomes a
 * second, nearly identical course that then collects registrations and
 * grades. Everything below is about the boundary between those two --
 * what the form is now allowed to create, and what it must still refuse.
 */

const id = () => randomUUID();
const SUPER = id(), ADMIN = id();
const COLLEGE = id(), DEPT = id(), YEAR = id(), SEM = id(), SEM_RUNNING = id();
const EXISTING_COURSE = id();
const PREFIX = `QCE${COLLEGE.slice(0, 3).toUpperCase()}`;

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "t", mustChangePassword: false }) as Actor;

const admin = () => actorOf(ADMIN, "ADMIN");

/** Everything a valid offering needs except the course itself. */
const schedule = {
  semesterId: SEM,
  section: "1",
  days: [1, 3, 5],
  room: "PAPE 1",
  startTime: "09:00",
  endTime: "10:00",
};

describe("creating a course from the Add-an-offering form", () => {
  const createdCourseIds: string[] = [];
  const createdOfferingIds: string[] = [];

  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "Registrar", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `QC-${COLLEGE.slice(0, 6)}`, name: "Quick Entry College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COLLEGE, code: PREFIX, name: "Quick Entry Dept", isActive: true });
    await db.insert(academicYear).values({ id: YEAR, label: `QCE-${YEAR.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values([
      { id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "OPEN", startDate: "2026-09-01", endDate: "2027-01-15" },
      // Teaching has started here: schedules are frozen, so nothing on this
      // screen may write -- least of all a brand new course.
      { id: SEM_RUNNING, academicYearId: YEAR, sequence: 2, name: "Semester II", state: "IN_PROGRESS", startDate: "2027-01-20", endDate: "2027-06-30" },
    ]);
    await db.insert(course).values({
      id: EXISTING_COURSE, departmentId: DEPT, code: `${PREFIX}401`, title: "Already On Record", creditHours: 3, isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(offeringMeeting).where(inArray(offeringMeeting.offeringId, createdOfferingIds.length ? createdOfferingIds : [id()]));
    await db.delete(courseOffering).where(inArray(courseOffering.id, createdOfferingIds.length ? createdOfferingIds : [id()]));
    await db.delete(course).where(inArray(course.id, [EXISTING_COURSE, ...createdCourseIds]));
    await db.delete(semester).where(inArray(semester.id, [SEM, SEM_RUNNING]));
    await db.delete(academicYear).where(inArray(academicYear.id, [YEAR]));
    await db.delete(departmentTable).where(inArray(departmentTable.id, [DEPT]));
    await db.delete(collegeTable).where(inArray(collegeTable.id, [COLLEGE]));
    // The audit entries these tests cause point at the actor, so they go
    // before it does -- and they are the point of one of the assertions.
    await db.delete(auditLog).where(inArray(auditLog.actorUserId, [ADMIN, SUPER]));
    await db.delete(appUser).where(inArray(appUser.id, [ADMIN]));
  });

  /** Remember what a call created so afterAll can clean it up. */
  const track = async (offeringId: string) => {
    createdOfferingIds.push(offeringId);
    const row = await db.query.courseOffering.findFirst({ where: eq(courseOffering.id, offeringId) });
    if (row && row.courseId !== EXISTING_COURSE) createdCourseIds.push(row.courseId);
    return row!;
  };

  it("refuses an unknown code in a way the form can act on, and writes nothing", async () => {
    // Not a plain ValidationError: the screen has to tell "this code is not
    // on record" apart from "your end time is wrong" to know whether to
    // offer the add-a-course panel at all.
    const before = await db.query.course.findMany({ where: eq(course.departmentId, DEPT) });
    await expect(createOffering(admin(), { ...schedule, courseCode: `${PREFIX}999` })).rejects.toBeInstanceOf(
      UnknownCourseCodeError,
    );
    const after = await db.query.course.findMany({ where: eq(course.departmentId, DEPT) });
    expect(after).toHaveLength(before.length);
  });

  it("creates the course and the offering together, with the schedule", async () => {
    const row = await createOffering(admin(), {
      ...schedule,
      section: "2",
      courseCode: `${PREFIX} 512`,
      newCourse: { departmentId: DEPT, title: "Invented Here", creditHours: 4 },
    });
    await track(row.id);

    const created = await db.query.course.findFirst({ where: eq(course.id, row.courseId) });
    expect(created?.title).toBe("Invented Here");
    expect(created?.creditHours).toBe(4);
    expect(created?.departmentId).toBe(DEPT);
    // Stored unspaced, like every other code, so it matches what the
    // picker and the prerequisite form resolve against.
    expect(created?.code).toBe(`${PREFIX}512`);

    // The credit hours are copied onto the offering at this moment and
    // never re-read, which is exactly why the form confirms them first.
    expect(row.frozenCreditHours).toBe(4);

    const meetings = await db.query.offeringMeeting.findMany({ where: eq(offeringMeeting.offeringId, row.id) });
    expect(meetings.map((m) => m.dayOfWeek).sort()).toEqual([1, 3, 5]);
  });

  it("uses the existing course when the code does match, and ignores the panel", async () => {
    const row = await createOffering(admin(), {
      ...schedule,
      section: "3",
      courseCode: `${PREFIX}401`,
      newCourse: { departmentId: DEPT, title: "Should Be Ignored", creditHours: 9 },
    });
    await track(row.id);

    expect(row.courseId).toBe(EXISTING_COURSE);
    // Not 9: the course on record is the authority, not what someone left
    // in a panel they did not need.
    expect(row.frozenCreditHours).toBe(3);
    const untouched = await db.query.course.findFirst({ where: eq(course.id, EXISTING_COURSE) });
    expect(untouched?.title).toBe("Already On Record");
  });

  it("publishes in the same breath when asked, and audits both steps", async () => {
    const row = await createOffering(admin(), {
      ...schedule,
      section: "4",
      courseCode: `${PREFIX}401`,
      publish: true,
    });
    await track(row.id);

    expect(row.status).toBe("PUBLISHED");

    // "Created, then published" -- the real lifecycle, not an offering that
    // sprang into existence already live.
    const entries = await db.query.auditLog.findMany({ where: eq(auditLog.entityId, row.id) });
    expect(entries.map((e) => e.action).sort()).toEqual(["OFFERING_CREATED", "OFFERING_PUBLISHED"]);
  });

  it("leaves it a draft when not asked", async () => {
    const row = await createOffering(admin(), { ...schedule, section: "5", courseCode: `${PREFIX}401` });
    await track(row.id);
    expect(row.status).toBe("DRAFT");
  });

  it("creates no course when the rest of the offering is invalid", async () => {
    // The whole reason the course is resolved last. A course orphaned by a
    // bad end time is exactly the junk row the confirmation step exists to
    // prevent, and it would be invisible -- the screen reports the time
    // error, and nobody thinks to go looking in the catalogue.
    await expect(
      createOffering(admin(), {
        ...schedule,
        section: "6",
        courseCode: `${PREFIX}777`,
        endTime: "08:00",
        newCourse: { departmentId: DEPT, title: "Never Born", creditHours: 3 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const orphan = (await db.query.course.findMany({ where: eq(course.departmentId, DEPT) })).find(
      (c) => c.title === "Never Born",
    );
    expect(orphan).toBeUndefined();
  });

  it("will not create a course for a semester whose teaching has started", async () => {
    await expect(
      createOffering(admin(), {
        ...schedule,
        semesterId: SEM_RUNNING,
        courseCode: `${PREFIX}888`,
        newCourse: { departmentId: DEPT, title: "Too Late", creditHours: 3 },
      }),
    ).rejects.toThrow(/frozen|In Progress/i);

    const late = (await db.query.course.findMany({ where: eq(course.departmentId, DEPT) })).find(
      (c) => c.title === "Too Late",
    );
    expect(late).toBeUndefined();
  });

  it("refuses a department that does not exist rather than inventing one", async () => {
    await expect(
      createOffering(admin(), {
        ...schedule,
        section: "7",
        courseCode: `${PREFIX}666`,
        newCourse: { departmentId: id(), title: "Homeless", creditHours: 3 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("will not let a Super Admin create a course here", async () => {
    // REQ-R04: a Super Admin is denied structure.manageCourse AND
    // offering.manage. This screen must not become the back door to either.
    await expect(
      createOffering(actorOf(SUPER, "SUPER_ADMIN"), {
        ...schedule,
        section: "8",
        courseCode: `${PREFIX}555`,
        newCourse: { departmentId: DEPT, title: "Back Door", creditHours: 3 },
      }),
    ).rejects.toThrow(/Not available to your role/i);

    const backDoor = (await db.query.course.findMany({ where: eq(course.departmentId, DEPT) })).find(
      (c) => c.title === "Back Door",
    );
    expect(backDoor).toBeUndefined();
  });
});
