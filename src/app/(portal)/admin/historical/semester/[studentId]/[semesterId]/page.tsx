import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getStudent } from "@/lib/students/students";
import { fullName } from "@/lib/students/name";
import { semesterFullLabel } from "@/lib/academic/semesterName";
import { formatCourseCode } from "@/lib/courses/courseCode";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import SemesterEditForm from "../../SemesterEditForm";

export const metadata: Metadata = { title: "Edit past semester" };

/**
 * Edit one past semester of one student: the imported grades as a grid that
 * can be changed, added to or taken out, with one save. Admin only; a Super
 * Admin cannot correct records (REQ-R04).
 */
export default async function EditPastSemesterPage({ params }: { params: Promise<{ studentId: string; semesterId: string }> }) {
  const actor = await getCurrentActor();
  const { studentId, semesterId } = await params;
  const shell = (children: React.ReactNode) => (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
      {children}
    </main>
  );

  if (!actor) return shell("Please sign in.");
  if (actor.role !== "ADMIN") return shell(<Alert tone="info">Only an Admin can edit past grades.</Alert>);

  let record;
  try {
    record = await getStudent(actor, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) return shell(<Alert tone="info">Student not found.</Alert>);
    throw err;
  }

  const [sem, records, courses, departments, colleges, scaleRows] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, semesterId) }),
      tx.query.academicRecord.findMany({
        where: (r, { and, eq }) => and(eq(r.studentId, studentId), eq(r.semesterId, semesterId), eq(r.isVoid, false)),
        orderBy: (r, { asc }) => asc(r.courseCodeSnapshot),
      }),
      tx.query.course.findMany({ columns: { code: true, title: true, creditHours: true } }),
      tx.query.department.findMany({ columns: { id: true, name: true, isActive: true, collegeId: true } }),
      tx.query.college.findMany({ columns: { id: true, name: true } }),
      tx.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    ]),
  );
  if (!sem) return shell(<Alert tone="info">Semester not found.</Alert>);
  const year = await asUser(actor.userId, (tx) => tx.query.academicYear.findFirst({ where: (y, { eq }) => eq(y.id, sem.academicYearId) }));
  const label = semesterFullLabel(year, sem, "Semester");
  const ended = new Date(sem.endDate) < new Date();

  const version = Math.max(...scaleRows.map((g) => g.policyVersion));
  const grades = scaleRows
    .filter((g) => g.policyVersion === version)
    .sort((a, b) => (b.gradePoint === null ? -1 : a.gradePoint === null ? 1 : Number(b.gradePoint) - Number(a.gradePoint)))
    .map((g) => ({ letter: g.letter, gradePoint: g.gradePoint === null ? null : Number(g.gradePoint), countsInGpa: g.countsInGpa }));

  const editable = records.filter((r) => r.origin === "IMPORTED");
  const locked = records.filter((r) => r.origin !== "IMPORTED");

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader
        title="Edit past semester"
        description={
          <>
            {fullName(record)} ({record.studentNumber}) —{" "}
            <Link href={`/admin/historical?studentId=${studentId}`} className="font-medium text-brand-fg hover:underline">
              Back to past record
            </Link>
          </>
        }
      />
      {!ended ? (
        <Alert tone="warning">{label} has not ended yet. Past grades can only be edited for a semester that is over.</Alert>
      ) : (
        <SemesterEditForm
          student={{ id: record.id, name: fullName(record), studentNumber: record.studentNumber, departmentId: record.departmentId }}
          semester={{ id: sem.id, label }}
          initialRows={editable.map((r) => ({
            recordId: r.id,
            code: formatCourseCode(r.courseCodeSnapshot),
            title: r.courseTitleSnapshot,
            hours: String(Number(r.creditHours)),
            letter: r.letter,
            inCatalogue: r.courseId !== null,
          }))}
          locked={locked.map((r) => ({ code: formatCourseCode(r.courseCodeSnapshot), title: r.courseTitleSnapshot, letter: r.letter, creditHours: r.creditHours }))}
          courses={courses.map((c) => ({ code: c.code, title: c.title, creditHours: c.creditHours }))}
          departments={departments
            .map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, collegeName: colleges.find((c) => c.id === d.collegeId)?.name ?? "Other" }))
            .sort((a, b) => a.collegeName.localeCompare(b.collegeName) || a.name.localeCompare(b.name))}
          grades={grades}
        />
      )}
    </main>
  );
}
