import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
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

export const metadata: Metadata = { title: "Academic structure" };

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

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
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
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Academic structure" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Colleges */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-neutral-900">Colleges</h2>
        <form action={createCollegeAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs" htmlFor="college-code">
              Code
            </Label>
            <Input id="college-code" name="code" required />
          </div>
          <div>
            <Label className="text-xs" htmlFor="college-name">
              Name
            </Label>
            <Input id="college-name" name="name" required />
          </div>
          <Button type="submit">Add college</Button>
        </form>
        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {colleges.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs text-neutral-700">{c.code}</Td>
                  <Td className="font-medium text-neutral-900">{c.name}</Td>
                  <Td>
                    <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleCollegeActiveAction}>
                      <input type="hidden" name="collegeId" value={c.id} />
                      <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                      <button type="submit" className="font-medium text-brand-700 hover:underline">
                        {c.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* Departments */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-neutral-900">Departments</h2>
        <form action={createDepartmentAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs" htmlFor="dept-college">
              College
            </Label>
            <Select id="dept-college" name="collegeId" required>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs" htmlFor="dept-code">
              Code
            </Label>
            <Input id="dept-code" name="code" required />
          </div>
          <div>
            <Label className="text-xs" htmlFor="dept-name">
              Name
            </Label>
            <Input id="dept-name" name="name" required />
          </div>
          <div>
            <Label className="text-xs" htmlFor="dept-max">
              Credit ceiling (optional)
            </Label>
            <Input id="dept-max" name="maxCreditsOverride" type="number" min={1} max={21} className="w-24" />
          </div>
          <Button type="submit">Add department</Button>
        </form>
        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>College</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {departments.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-mono text-xs text-neutral-700">{d.code}</Td>
                  <Td className="font-medium text-neutral-900">{d.name}</Td>
                  <Td>{collegeName(d.collegeId)}</Td>
                  <Td>
                    <Badge tone={d.isActive ? "success" : "neutral"}>{d.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleDepartmentActiveAction}>
                      <input type="hidden" name="departmentId" value={d.id} />
                      <input type="hidden" name="isActive" value={(!d.isActive).toString()} />
                      <button type="submit" className="font-medium text-brand-700 hover:underline">
                        {d.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* Courses */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-neutral-900">Courses</h2>
        <form action={createCourseAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs" htmlFor="course-dept">
              Department
            </Label>
            <Select id="course-dept" name="departmentId" required>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs" htmlFor="course-code">
              Code
            </Label>
            <Input id="course-code" name="code" required placeholder="CSC 201" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="course-title">
              Title
            </Label>
            <Input id="course-title" name="title" required />
          </div>
          <div>
            <Label className="text-xs" htmlFor="course-credits">
              Credit hours
            </Label>
            <Input id="course-credits" name="creditHours" type="number" min={1} required className="w-20" />
          </div>
          <Button type="submit">Add course</Button>
        </form>
        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Code</Th>
                <Th>Title</Th>
                <Th>Department</Th>
                <Th>Credits</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {courses.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs text-neutral-700">{c.code}</Td>
                  <Td className="font-medium text-neutral-900">{c.title}</Td>
                  <Td>{departmentName(c.departmentId)}</Td>
                  <Td>{c.creditHours}</Td>
                  <Td>
                    <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleCourseActiveAction}>
                      <input type="hidden" name="courseId" value={c.id} />
                      <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                      <button type="submit" className="font-medium text-brand-700 hover:underline">
                        {c.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* Prerequisites */}
      <section>
        <h2 className="mb-3 font-medium text-neutral-900">Prerequisites</h2>
        <form action={addPrerequisiteAction} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs" htmlFor="prereq-course">
              Course
            </Label>
            <Select id="prereq-course" name="courseId" required>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs" htmlFor="prereq-of">
              Requires
            </Label>
            <Select id="prereq-of" name="prerequisiteCourseId" required>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">Add prerequisite</Button>
        </form>
        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Course</Th>
                <Th>Requires</Th>
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {prerequisites.map((p) => (
                <Tr key={`${p.courseId}:${p.prerequisiteCourseId}`}>
                  <Td className="font-mono text-xs text-neutral-700">{courseCode(p.courseId)}</Td>
                  <Td className="font-mono text-xs text-neutral-700">{courseCode(p.prerequisiteCourseId)}</Td>
                  <Td>
                    <form action={removePrerequisiteAction}>
                      <input type="hidden" name="courseId" value={p.courseId} />
                      <input type="hidden" name="prerequisiteCourseId" value={p.prerequisiteCourseId} />
                      <button type="submit" className="font-medium text-danger-600 hover:underline">
                        Remove
                      </button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>
    </main>
  );
}
