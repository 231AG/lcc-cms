import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser, academicYear, semester, auditLog } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStaffAccount } from "@/lib/identity/accounts";
import { createAcademicYear, createSemester, transitionSemester } from "../calendar";
import { ForbiddenError, StateError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Section 24.5 Stage 4 acceptance criteria, automated: all 30 illegal
 * transitions refused (unit-tested exhaustively in
 * semesterStateMachine.test.ts); here we verify the service wraps that
 * pure table correctly against a real semester row -- role enforcement,
 * reason requirement, the Section 13.6 one-semester-per-window invariant,
 * and that every transition is audited with from-state and to-state.
 */

let adminActor: Actor;
let superAdminActor: Actor;
let adminUserId: string;
const studentActor: Actor = { userId: "00000000-0000-0000-0000-000000000001", role: "STUDENT" };

// Cleanup is collected here rather than inline at the end of each test: a
// thrown assertion or a timeout skips the rest of the test body, and an
// earlier version of this suite that deleted its fixture rows inline left
// a stray semester behind after one such timeout, which then broke every
// later run (fixed sequence 1 already existed under the shared fixture
// year). afterAll always runs, so it's the only place cleanup is safe.
const cleanupSemesterIds: string[] = [];
const cleanupAcademicYearIds: string[] = [];
let yearCounter = 0;

async function realSuperAdminActor(): Promise<Actor> {
  const row = await db.query.appUser.findFirst({
    where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")),
  });
  if (!row) throw new Error("No active Super Admin exists to bootstrap this suite's fixtures.");
  return { userId: row.id, role: "SUPER_ADMIN" };
}

beforeAll(async () => {
  superAdminActor = await realSuperAdminActor();
  const { username } = await createStaffAccount({
    actor: superAdminActor,
    username: `test-calendar-admin-${Date.now()}`,
    displayName: "Calendar Test Admin",
    role: "ADMIN",
  });
  const row = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, username) });
  if (!row) throw new Error("fixture setup failed");
  adminUserId = row.id;
  adminActor = { userId: row.id, role: "ADMIN" };
});

afterAll(async () => {
  for (const id of cleanupSemesterIds) {
    await db.delete(semester).where(eq(semester.id, id)).catch(() => {});
  }
  for (const id of cleanupAcademicYearIds) {
    await db.delete(academicYear).where(eq(academicYear.id, id)).catch(() => {});
  }
  if (adminUserId) {
    await db.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, adminUserId));
    await createAdminClient().auth.admin.deleteUser(adminUserId).catch(() => {});
  }
});

/** A fresh, never-reused academic year per call -- so no two tests (or a
 * retried/failed run) can ever collide on a semester sequence number. */
async function makeYear() {
  yearCounter += 1;
  const base = 2200 + yearCounter;
  const label = `${base}/${base + 1}`;
  const year = await createAcademicYear(adminActor, {
    label,
    startDate: `${base}-08-01`,
    endDate: `${base + 1}-06-30`,
  });
  cleanupAcademicYearIds.push(year.id);
  return year;
}

async function makeYearAndSemester() {
  const year = await makeYear();
  const sem = await createSemester(adminActor, {
    academicYearId: year.id,
    sequence: 1,
    name: "First Semester",
    startDate: `${year.startDate.slice(0, 4)}-09-01`,
    endDate: `${year.endDate.slice(0, 4)}-01-15`,
  });
  cleanupSemesterIds.push(sem.id);
  return { year, semester: sem };
}

describe("createAcademicYear", () => {
  it("refuses a malformed label", async () => {
    await expect(
      createAcademicYear(adminActor, { label: "2026-2027", startDate: "2026-08-01", endDate: "2027-06-30" }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses non-consecutive years", async () => {
    await expect(
      createAcademicYear(adminActor, { label: "2026/2028", startDate: "2026-08-01", endDate: "2027-06-30" }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a Student and a Super Admin", async () => {
    await expect(
      createAcademicYear(studentActor, { label: "2050/2051", startDate: "2050-08-01", endDate: "2051-06-30" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createAcademicYear(superAdminActor, { label: "2050/2051", startDate: "2050-08-01", endDate: "2051-06-30" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("createSemester", () => {
  it("refuses dates outside the parent academic year", async () => {
    const year = await makeYear();

    await expect(
      createSemester(adminActor, {
        academicYearId: year.id,
        sequence: 1,
        name: "First Semester",
        startDate: "2051-01-01", // before the year starts
        endDate: "2051-12-31",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a duplicate sequence within the same year", async () => {
    const { year } = await makeYearAndSemester();

    await expect(
      createSemester(adminActor, {
        academicYearId: year.id,
        sequence: 1,
        name: "Duplicate First Semester",
        startDate: `${year.startDate.slice(0, 4)}-09-01`,
        endDate: `${year.endDate.slice(0, 4)}-01-15`,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("transitionSemester", () => {
  it("advances DRAFT -> OPEN as Admin, and audits from/to state", async () => {
    const { semester: sem } = await makeYearAndSemester();

    const updated = await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN" });
    expect(updated.state).toBe("OPEN");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "semester"), eq(auditLog.entityId, sem.id)),
    });
    const transitionEntry = entries.find((e) => e.action === "SEMESTER_STATE_CHANGED");
    expect(transitionEntry?.oldValue).toEqual({ state: "DRAFT" });
    expect(transitionEntry?.newValue).toEqual({ state: "OPEN" });
  });

  it("refuses an Admin attempting a backward transition", async () => {
    const { semester: sem } = await makeYearAndSemester();
    await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN" });

    await expect(
      transitionSemester(adminActor, { semesterId: sem.id, toState: "DRAFT" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a Super Admin attempting a forward transition", async () => {
    const { semester: sem } = await makeYearAndSemester();

    await expect(
      transitionSemester(superAdminActor, { semesterId: sem.id, toState: "OPEN" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses an illegal jump (e.g. DRAFT straight to CLOSED)", async () => {
    const { semester: sem } = await makeYearAndSemester();

    await expect(
      transitionSemester(adminActor, { semesterId: sem.id, toState: "CLOSED" }),
    ).rejects.toThrow(StateError);
  });

  it("requires a reason for a Super Admin backward transition, and audits it", async () => {
    const { semester: sem } = await makeYearAndSemester();
    await transitionSemester(adminActor, { semesterId: sem.id, toState: "OPEN" });

    await expect(
      transitionSemester(superAdminActor, { semesterId: sem.id, toState: "DRAFT" }),
    ).rejects.toThrow(ValidationError);

    const withReason = await transitionSemester(superAdminActor, {
      semesterId: sem.id,
      toState: "DRAFT",
      reason: "Testing the reopen path",
    });
    expect(withReason.state).toBe("DRAFT");

    const entries = await db.query.auditLog.findMany({
      where: and(eq(auditLog.entityType, "semester"), eq(auditLog.entityId, sem.id)),
    });
    const backwardEntry = entries.find((e) => e.newValue && (e.newValue as { state?: string }).state === "DRAFT");
    expect(backwardEntry?.reason).toBe("Testing the reopen path");
  });

  it("enforces at most one semester in REGISTRATION at a time (Section 13.6)", async () => {
    // ~8 sequential Supabase round trips in this one test (a
    // create-year-and-semester setup plus a second semester plus four
    // transitions) -- comfortably over the shared 40s default under real
    // network latency, matching this project's established pattern of
    // widening the timeout for genuinely round-trip-heavy tests rather
    // than the global default.
    const { year, semester: semA } = await makeYearAndSemester();
    const semB = await createSemester(adminActor, {
      academicYearId: year.id,
      sequence: 2,
      name: "Second Semester",
      startDate: `${year.endDate.slice(0, 4)}-02-01`,
      endDate: `${year.endDate.slice(0, 4)}-06-30`,
    });
    cleanupSemesterIds.push(semB.id);

    await transitionSemester(adminActor, { semesterId: semA.id, toState: "OPEN" });
    await transitionSemester(adminActor, { semesterId: semA.id, toState: "REGISTRATION" });

    await transitionSemester(adminActor, { semesterId: semB.id, toState: "OPEN" });
    await expect(
      transitionSemester(adminActor, { semesterId: semB.id, toState: "REGISTRATION" }),
    ).rejects.toThrow(StateError);
  }, 90_000);
});
