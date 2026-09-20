import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  academicRecord,
  academicYear,
  appUser,
  college as collegeTable,
  course,
  department as departmentTable,
  semester,
  student as studentTable,
  studentPhoto,
} from "@/lib/db/schema";
import { getGradeSheet } from "@/lib/gradesheet/gradeSheet";
import { getStudent } from "@/lib/students/students";
import { getCumulativeSummary, getSemesterSummaries } from "@/lib/gpa/gpa";
import { getStudentHistory } from "@/lib/historical/historical";
import { getStudentPhoto, getStudentPhotoMeta } from "@/lib/students/photo";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * THE AUTHORIZATION TEST THIS CODEBASE DID NOT HAVE.
 *
 * Every student-scoped reader in the app -- getGradeSheet, getStudent,
 * getCumulativeSummary, getSemesterSummaries, getStudentHistory -- takes a
 * `studentId` as an ordinary argument and applies NO service-layer check
 * that it belongs to the caller. They are safe only because they read
 * through asUser(), which downgrades the connection to `authenticated` and
 * sets request.jwt.claim.sub, so Postgres row-level security decides what
 * comes back.
 *
 * That is a legitimate design, but it means the entire confidentiality
 * boundary between one student and the next rests on RLS policies being
 * enabled and correct -- a property nothing in the test suite asserted. A
 * policy dropped in a future migration, or an `asUser` quietly swapped for
 * the superuser `db` handle during a refactor, would hand every student
 * every other student's transcript with no test going red.
 *
 * So: two real students, both with grades, and student A asking for
 * student B's records through each reader in turn.
 */

const id = () => randomUUID();
const SUPER = id();
const COL = id(), DEPT = id(), YEAR = id(), SEM = id(), COURSE = id();
const A = id(), B = id();
let seq = Math.floor(Math.random() * 8000);

const actorOf = (userId: string): Actor => ({ userId, role: "STUDENT" }) as Actor;

async function makeStudent(uid: string, first: string) {
  const studentNumber = `2026${String(++seq).padStart(4, "0")}`;
  await db.insert(appUser).values({
    id: uid, loginIdentifier: studentNumber, displayName: first,
    role: "STUDENT", status: "ACTIVE", mustChangePassword: false,
  });
  await db.insert(studentTable).values({
    id: uid, studentNumber, firstName: first, lastName: "Isolation",
    departmentId: DEPT, enrolmentYear: 2026, status: "ACTIVE",
    historicalImportStatus: "COMPLETE", createdBy: SUPER,
  });
  await db.insert(academicRecord).values({
    studentId: uid, semesterId: SEM, courseId: COURSE,
    courseCodeSnapshot: "SEC101", courseTitleSnapshot: `${first} secret result`,
    creditHours: "3.0", letter: "A+", gradePoint: "4.00", score: 99,
    origin: "IMPORTED", countsInGpa: true, countsInAttempted: true,
    countsInEarned: true, enteredBy: SUPER,
  });
}

describe("one student cannot read another student's records", () => {
  beforeAll(async () => {
    await db.insert(appUser).values({
      id: SUPER, loginIdentifier: `sec-${SUPER}@lcc.edu`, displayName: "Fixture Super Admin",
      role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false,
    });
    await db.insert(collegeTable).values({ id: COL, code: `SEC${COL.slice(0, 4)}`, name: "Isolation College", isActive: true });
    await db.insert(departmentTable).values({ id: DEPT, collegeId: COL, code: `SD${DEPT.slice(0, 2)}`, name: "Isolation Dept", isActive: true });
    await db.insert(academicYear).values({ id: YEAR, label: `SEC-${YEAR.slice(0, 8)}`, startDate: "2026-09-01", endDate: "2027-06-30", isCurrent: false });
    await db.insert(semester).values({ id: SEM, academicYearId: YEAR, sequence: 1, name: "Semester I", state: "CLOSED", startDate: "2026-09-01", endDate: "2027-01-15" });
    await db.insert(course).values({ id: COURSE, departmentId: DEPT, code: `SEC${COURSE.slice(0, 3)}`, title: "Isolation", creditHours: 3, isActive: true });
    await makeStudent(A, "Ama");
    await makeStudent(B, "Bea");

    // A photograph each. Inserted through the raw connection rather than
    // setStudentPhoto() on purpose: this suite is about what Postgres
    // refuses to hand back, not about the upload path.
    const pixel = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01]);
    await db.insert(studentPhoto).values([
      { studentId: A, contentType: "image/jpeg", byteSize: pixel.length, data: pixel, uploadedBy: SUPER },
      { studentId: B, contentType: "image/jpeg", byteSize: pixel.length, data: pixel, uploadedBy: SUPER },
    ]);
  });

  it("the fixture is real: each student can read their OWN grade sheet", async () => {
    const own = await getGradeSheet(actorOf(A), A, SEM);
    expect(own.courses).toHaveLength(1);
    expect(own.courses[0].title).toBe("Ama secret result");
  });

  it("getGradeSheet refuses another student's transcript", async () => {
    // RLS hides the student row, so the reader cannot even resolve the
    // subject -- it must not fall through to an empty-but-successful sheet
    // carrying the other student's name.
    await expect(getGradeSheet(actorOf(A), B, SEM)).rejects.toThrow(/not found/i);
  });

  it("getStudent refuses another student's profile", async () => {
    await expect(getStudent(actorOf(A), B)).rejects.toThrow();
  });

  it("the GPA readers return nothing for another student", async () => {
    expect(await getCumulativeSummary(actorOf(A), B)).toBeNull();
    expect(await getSemesterSummaries(actorOf(A), B)).toEqual([]);
  });

  it("the history reader returns nothing for another student", async () => {
    const history = await getStudentHistory(actorOf(A), B);
    const rows = Array.isArray(history) ? history : (history as { records?: unknown[] })?.records ?? [];
    expect(rows).toHaveLength(0);
  });

  it("a student can fetch their OWN photograph", async () => {
    const own = await getStudentPhoto(actorOf(A), A);
    expect(own).not.toBeNull();
    expect(own!.contentType).toBe("image/jpeg");
    expect(await getStudentPhotoMeta(actorOf(A), A)).not.toBeNull();
  });

  it("a student cannot fetch another student's photograph", async () => {
    // The serve route has NO ownership check of its own -- it hands the
    // id straight to this reader and 404s on null. So this assertion is
    // the whole of what stops one student pulling another's face out of
    // /api/students/<id>/photo by editing the URL.
    expect(await getStudentPhoto(actorOf(A), B)).toBeNull();
    expect(await getStudentPhotoMeta(actorOf(A), B)).toBeNull();
  });

  it("RLS is the thing doing it: the raw connection sees both, asUser sees one", async () => {
    // Proves the test is not passing for some incidental reason -- the data
    // IS there, and only the downgraded connection is being stopped.
    const all = await db.query.academicRecord.findMany({ where: eq(academicRecord.semesterId, SEM) });
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Same for the photographs: both rows exist, and only the downgraded
    // connection is being stopped from seeing the second one.
    const photos = await db.query.studentPhoto.findMany();
    expect(photos.filter((p) => p.studentId === A || p.studentId === B)).toHaveLength(2);
  });
});
