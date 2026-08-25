import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import {
  createCollegeAction,
  toggleCollegeActiveAction,
  createDepartmentAction,
  toggleDepartmentActiveAction,
  createCourseAction,
  toggleCourseActiveAction,
  addPrerequisiteAction,
  removePrerequisiteAction,
} from "./actions";

/**
 * A-02 through A-05 combined onto one page for Stage 3 (plan Section 20.4).
 * Colleges, Departments, Courses, and Prerequisites -- Admin-only, exactly
 * like /admin/accounts is Super-Admin-only (Section 20.2's permission-denied
 * convention: hide the controls, let assertCan() in the actions be the
 * real enforcement).
 */
export default async function AcademicStructurePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { error } = await searchParams;

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
      </main>
    );
  }

  const [colleges, departments, courses, prerequisites] = await asUser(actor.userId, async (tx) => {
    return Promise.all([
      tx.query.college.findMany({ orderBy: (row, { asc }) => asc(row.code) }),
      tx.query.department.findMany({ orderBy: (row, { asc }) => asc(row.code) }),
      tx.query.course.findMany({ orderBy: (row, { asc }) => asc(row.code) }),
      tx.query.coursePrerequisite.findMany(),
    ]);
  });

  const collegeName = (id: string) => colleges.find((c) => c.id === id)?.name ?? id;
  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  const courseCode = (id: string) => courses.find((c) => c.id === id)?.code ?? id;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Academic structure</h1>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* Colleges */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium">Colleges</h2>
        <form action={createCollegeAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="college-code">Code</label>
            <input id="college-code" name="code" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="college-name">Name</label>
            <input id="college-name" name="name" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
            Add college
          </button>
        </form>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Code</th>
              <th className="py-1">Name</th>
              <th className="py-1">Status</th>
              <th className="py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {colleges.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-1">{c.code}</td>
                <td className="py-1">{c.name}</td>
                <td className="py-1">{c.isActive ? "ACTIVE" : "INACTIVE"}</td>
                <td className="py-1">
                  <form action={toggleCollegeActiveAction}>
                    <input type="hidden" name="collegeId" value={c.id} />
                    <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                    <button type="submit" className="text-blue-700 underline">
                      {c.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Departments */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium">Departments</h2>
        <form action={createDepartmentAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="dept-college">College</label>
            <select id="dept-college" name="collegeId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="dept-code">Code</label>
            <input id="dept-code" name="code" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="dept-name">Name</label>
            <input id="dept-name" name="name" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="dept-max">Credit ceiling (optional)</label>
            <input id="dept-max" name="maxCreditsOverride" type="number" min={1} max={21} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
            Add department
          </button>
        </form>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Code</th>
              <th className="py-1">Name</th>
              <th className="py-1">College</th>
              <th className="py-1">Status</th>
              <th className="py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-b">
                <td className="py-1">{d.code}</td>
                <td className="py-1">{d.name}</td>
                <td className="py-1">{collegeName(d.collegeId)}</td>
                <td className="py-1">{d.isActive ? "ACTIVE" : "INACTIVE"}</td>
                <td className="py-1">
                  <form action={toggleDepartmentActiveAction}>
                    <input type="hidden" name="departmentId" value={d.id} />
                    <input type="hidden" name="isActive" value={(!d.isActive).toString()} />
                    <button type="submit" className="text-blue-700 underline">
                      {d.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Courses */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium">Courses</h2>
        <form action={createCourseAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="course-dept">Department</label>
            <select id="course-dept" name="departmentId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="course-code">Code</label>
            <input id="course-code" name="code" required placeholder="CSC 201" className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="course-title">Title</label>
            <input id="course-title" name="title" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="course-credits">Credit hours</label>
            <input id="course-credits" name="creditHours" type="number" min={1} required className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
            Add course
          </button>
        </form>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Code</th>
              <th className="py-1">Title</th>
              <th className="py-1">Department</th>
              <th className="py-1">Credits</th>
              <th className="py-1">Status</th>
              <th className="py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-1">{c.code}</td>
                <td className="py-1">{c.title}</td>
                <td className="py-1">{departmentName(c.departmentId)}</td>
                <td className="py-1">{c.creditHours}</td>
                <td className="py-1">{c.isActive ? "ACTIVE" : "INACTIVE"}</td>
                <td className="py-1">
                  <form action={toggleCourseActiveAction}>
                    <input type="hidden" name="courseId" value={c.id} />
                    <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                    <button type="submit" className="text-blue-700 underline">
                      {c.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Prerequisites */}
      <section>
        <h2 className="mb-3 font-medium">Prerequisites</h2>
        <form action={addPrerequisiteAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="prereq-course">Course</label>
            <select id="prereq-course" name="courseId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="prereq-of">Requires</label>
            <select id="prereq-of" name="prerequisiteCourseId" required className="rounded border border-gray-300 px-2 py-1 text-sm">
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
            Add prerequisite
          </button>
        </form>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Course</th>
              <th className="py-1">Requires</th>
              <th className="py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {prerequisites.map((p) => (
              <tr key={`${p.courseId}:${p.prerequisiteCourseId}`} className="border-b">
                <td className="py-1">{courseCode(p.courseId)}</td>
                <td className="py-1">{courseCode(p.prerequisiteCourseId)}</td>
                <td className="py-1">
                  <form action={removePrerequisiteAction}>
                    <input type="hidden" name="courseId" value={p.courseId} />
                    <input type="hidden" name="prerequisiteCourseId" value={p.prerequisiteCourseId} />
                    <button type="submit" className="text-red-700 underline">Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
