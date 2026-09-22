import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPaste } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { TableCard } from "@/components/ui/TableCard";
import { Pagination } from "@/components/ui/Pagination";
import { buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td, SortableTh, type SortDirection } from "@/components/ui/Table";
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
const PAGE_SIZE = 10;

export default async function AcademicStructurePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    deptPage?: string;
    coursePage?: string;
    deptCollegeId?: string;
    deptQ?: string;
    deptSort?: string;
    deptDir?: string;
    courseQ?: string;
    courseSort?: string;
    courseDir?: string;
  }>;
}) {
  const actor = await getCurrentActor();
  const { error, deptPage, coursePage, deptCollegeId, deptQ, deptSort, deptDir, courseQ, courseSort, courseDir } =
    await searchParams;

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

  // Search, then sort, then page -- in that order, so page 2 is page 2 of
  // what the user is actually looking at rather than of everything.
  const hay = (...parts: Array<string | number | null | undefined>) =>
    parts.filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
  const matches = (needle: string | undefined, straw: string) =>
    !needle?.trim() || straw.includes(needle.trim().toLowerCase());

  /** Sorting by a column that does not exist would silently return the list
   *  unsorted, so the known keys are named and anything else falls back. */
  const dirOf = (d: string | undefined): SortDirection => (d === "desc" ? "desc" : "asc");
  const byText = (a: string, b: string, dir: SortDirection) =>
    dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);

  const activeDeptCollege = deptCollegeId && colleges.some((c) => c.id === deptCollegeId) ? deptCollegeId : undefined;
  const deptSortColumn = ["code", "name", "college", "status"].includes(deptSort ?? "") ? deptSort! : "code";
  const deptDirection = dirOf(deptDir);
  const visibleDepartments = departments
    .filter((d) => !activeDeptCollege || d.collegeId === activeDeptCollege)
    .filter((d) => matches(deptQ, hay(d.code, d.name, collegeName(d.collegeId))))
    .sort((a, b) => {
      if (deptSortColumn === "name") return byText(a.name, b.name, deptDirection);
      if (deptSortColumn === "college")
        return byText(collegeName(a.collegeId), collegeName(b.collegeId), deptDirection);
      if (deptSortColumn === "status")
        return byText(String(a.isActive), String(b.isActive), deptDirection);
      return byText(a.code, b.code, deptDirection);
    });

  const courseSortColumn = ["code", "title", "department", "credits", "status"].includes(courseSort ?? "")
    ? courseSort!
    : "code";
  const courseDirection = dirOf(courseDir);
  const visibleCourses = courses
    .filter((c) => matches(courseQ, hay(c.code, c.title, departmentName(c.departmentId))))
    .sort((a, b) => {
      if (courseSortColumn === "title") return byText(a.title, b.title, courseDirection);
      if (courseSortColumn === "department")
        return byText(departmentName(a.departmentId), departmentName(b.departmentId), courseDirection);
      if (courseSortColumn === "credits")
        return courseDirection === "asc" ? a.creditHours - b.creditHours : b.creditHours - a.creditHours;
      if (courseSortColumn === "status") return byText(String(a.isActive), String(b.isActive), courseDirection);
      return byText(a.code, b.code, courseDirection);
    });

  const deptPageNum = Math.max(1, Number(deptPage) || 1);
  const totalDeptPages = Math.max(1, Math.ceil(visibleDepartments.length / PAGE_SIZE));
  const pagedDepartments = visibleDepartments.slice((deptPageNum - 1) * PAGE_SIZE, deptPageNum * PAGE_SIZE);
  /** Every link on this page keeps every OTHER control's state. Sorting the
   *  courses must not clear the department filter, and paging must not
   *  clear the search -- each of which is a small betrayal the first time
   *  it happens. */
  const structureHref = (extra: Record<string, string | undefined>, hash: string) => {
    const sp = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      deptCollegeId: activeDeptCollege,
      deptQ: deptQ?.trim() || undefined,
      deptSort: deptSortColumn !== "code" ? deptSortColumn : undefined,
      deptDir: deptDirection !== "asc" ? deptDirection : undefined,
      courseQ: courseQ?.trim() || undefined,
      courseSort: courseSortColumn !== "code" ? courseSortColumn : undefined,
      courseDir: courseDirection !== "asc" ? courseDirection : undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) sp.set(k, v);
    const qs = sp.toString();
    return `/admin/structure${qs ? `?${qs}` : ""}#${hash}`;
  };

  const deptPageHref = (p: number) => structureHref({ deptPage: p > 1 ? String(p) : undefined }, "departments");
  const coursePageHref = (p: number) => structureHref({ coursePage: p > 1 ? String(p) : undefined }, "courses");
  // A new sort starts at page 1: staying on page 4 of a list that has just
  // been reordered shows rows nobody asked to see.
  const deptSortHref = (column: string, direction: SortDirection) =>
    structureHref({ deptSort: column, deptDir: direction, deptPage: undefined }, "departments");
  const courseSortHref = (column: string, direction: SortDirection) =>
    structureHref({ courseSort: column, courseDir: direction, coursePage: undefined }, "courses");

  const coursePageNum = Math.max(1, Number(coursePage) || 1);
  const totalCoursePages = Math.max(1, Math.ceil(visibleCourses.length / PAGE_SIZE));
  const pagedCourses = visibleCourses.slice((coursePageNum - 1) * PAGE_SIZE, coursePageNum * PAGE_SIZE);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <PageHeader title="Academic structure" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Colleges */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-fg">Colleges</h2>
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
          <SubmitButton pendingLabel="Adding…">Add college</SubmitButton>
        </form>
        <TableCard title="Colleges" count={colleges.length} countLabel="college">
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
                  <Td className="font-mono text-xs text-fg-secondary">{c.code}</Td>
                  <Td className="font-medium text-fg">{c.name}</Td>
                  <Td>
                    <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleCollegeActiveAction}>
                      <input type="hidden" name="collegeId" value={c.id} />
                      <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                      <SubmitTextButton className="font-medium text-brand-fg hover:underline">
                        {c.isActive ? "Deactivate" : "Reactivate"}
                      </SubmitTextButton>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      </section>

      {/* Departments */}
      <section id="departments" className="mb-10">
        <h2 className="mb-3 font-medium text-fg">Departments</h2>
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
          <SubmitButton pendingLabel="Adding…">Add department</SubmitButton>
        </form>
        <TableCard
          title="Departments"
          count={visibleDepartments.length}
          countLabel="department"
          filters={
            /* A plain GET form, applied on choice by the same
               data-auto-submit hook the other listings use, with the button
               kept as the no-JavaScript path. */
            <form method="GET" className="flex flex-wrap items-end gap-2">
              {/* The courses table's own search belongs to the form below;
                  carrying it here keeps this one from clearing it. */}
              {courseQ?.trim() && <input type="hidden" name="courseQ" value={courseQ} />}
              <div>
                <Label htmlFor="deptCollegeId" className="text-xs">
                  College
                </Label>
                <Select
                  id="deptCollegeId"
                  name="deptCollegeId"
                  defaultValue={activeDeptCollege ?? ""}
                  className="w-64"
                  data-auto-submit=""
                >
                  <option value="">All colleges</option>
                  {colleges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="deptQ" className="text-xs">
                  Search
                </Label>
                <Input
                  id="deptQ"
                  name="deptQ"
                  type="search"
                  defaultValue={deptQ ?? ""}
                  placeholder="Code, name or college"
                  className="sm:w-64"
                />
              </div>
              <SubmitButton variant="secondary">
                Apply
              </SubmitButton>
              {(activeDeptCollege || deptQ?.trim()) && (
                <Link href="/admin/structure#departments" className={buttonClasses("ghost", "md")}>
                  Clear
                </Link>
              )}
            </form>
          }
        >
          <Table>
            <Thead>
              <tr>
                <SortableTh label="Code" column="code" activeColumn={deptSortColumn} direction={deptDirection} hrefFor={deptSortHref} />
                <SortableTh label="Name" column="name" activeColumn={deptSortColumn} direction={deptDirection} hrefFor={deptSortHref} />
                <SortableTh label="College" column="college" activeColumn={deptSortColumn} direction={deptDirection} hrefFor={deptSortHref} />
                <SortableTh label="Status" column="status" activeColumn={deptSortColumn} direction={deptDirection} hrefFor={deptSortHref} />
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {pagedDepartments.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-mono text-xs text-fg-secondary">{d.code}</Td>
                  <Td className="font-medium text-fg">{d.name}</Td>
                  <Td>{collegeName(d.collegeId)}</Td>
                  <Td>
                    <Badge tone={d.isActive ? "success" : "neutral"}>{d.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleDepartmentActiveAction}>
                      <input type="hidden" name="departmentId" value={d.id} />
                      <input type="hidden" name="isActive" value={(!d.isActive).toString()} />
                      <SubmitTextButton className="font-medium text-brand-fg hover:underline">
                        {d.isActive ? "Deactivate" : "Reactivate"}
                      </SubmitTextButton>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
        {totalDeptPages > 1 && (
          <div className="mt-4 flex justify-end">
            <Pagination
              page={deptPageNum}
              totalPages={totalDeptPages}
              hrefForPage={deptPageHref}
              label="Departments pagination"
            />
          </div>
        )}
      </section>

      {/* Courses */}
      <section id="courses" className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-fg font-medium">Courses</h2>
          {/* The form below adds one course. The catalogue has hundreds,
              and they arrive as a list, not as an afternoon of typing. */}
          <Link href="/admin/structure/import" className={buttonClasses("secondary", "sm", "gap-1.5")}>
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
            Import a course list
          </Link>
        </div>
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
          <SubmitButton pendingLabel="Adding…">Add course</SubmitButton>
        </form>
        <TableCard
          title="Courses"
          count={visibleCourses.length}
          countLabel="course"
          filters={
            <form method="GET" className="flex flex-wrap items-end gap-2">
              {/* The department filter above belongs to the other table;
                  carrying it through keeps this form from silently
                  clearing it on submit. */}
              {activeDeptCollege && <input type="hidden" name="deptCollegeId" value={activeDeptCollege} />}
              {deptQ?.trim() && <input type="hidden" name="deptQ" value={deptQ} />}
              <div>
                <Label htmlFor="courseQ" className="text-xs">
                  Search
                </Label>
                <Input
                  id="courseQ"
                  name="courseQ"
                  type="search"
                  defaultValue={courseQ ?? ""}
                  placeholder="Code, title or department"
                  className="sm:w-72"
                />
              </div>
              <SubmitButton variant="secondary">Apply</SubmitButton>
              {courseQ?.trim() && (
                <Link href={structureHref({ courseQ: undefined, coursePage: undefined }, "courses")} className={buttonClasses("ghost", "md")}>
                  Clear
                </Link>
              )}
            </form>
          }
        >
          <Table>
            <Thead>
              <tr>
                <SortableTh label="Code" column="code" activeColumn={courseSortColumn} direction={courseDirection} hrefFor={courseSortHref} />
                <SortableTh label="Title" column="title" activeColumn={courseSortColumn} direction={courseDirection} hrefFor={courseSortHref} />
                <SortableTh label="Department" column="department" activeColumn={courseSortColumn} direction={courseDirection} hrefFor={courseSortHref} />
                <SortableTh label="Cr/Hrs" column="credits" activeColumn={courseSortColumn} direction={courseDirection} hrefFor={courseSortHref} />
                <SortableTh label="Status" column="status" activeColumn={courseSortColumn} direction={courseDirection} hrefFor={courseSortHref} />
                <Th>Action</Th>
              </tr>
            </Thead>
            <tbody>
              {pagedCourses.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs text-fg-secondary">{c.code}</Td>
                  <Td className="font-medium text-fg">{c.title}</Td>
                  <Td>{departmentName(c.departmentId)}</Td>
                  <Td>{c.creditHours}</Td>
                  <Td>
                    <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
                  </Td>
                  <Td>
                    <form action={toggleCourseActiveAction}>
                      <input type="hidden" name="courseId" value={c.id} />
                      <input type="hidden" name="isActive" value={(!c.isActive).toString()} />
                      <SubmitTextButton className="font-medium text-brand-fg hover:underline">
                        {c.isActive ? "Deactivate" : "Reactivate"}
                      </SubmitTextButton>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
        {totalCoursePages > 1 && (
          <div className="mt-4 flex justify-end">
            <Pagination
              page={coursePageNum}
              totalPages={totalCoursePages}
              hrefForPage={coursePageHref}
              label="Courses pagination"
            />
          </div>
        )}
      </section>

      {/* Prerequisites */}
      <section>
        <h2 className="mb-3 font-medium text-fg">Prerequisites</h2>
        <form action={addPrerequisiteAction} className="mb-4 flex flex-wrap items-end gap-2">
          {/* One shared <datalist> for both fields instead of two full
              <select>s: 178 courses rendered twice was 356 <option>
              elements on every load of this page, and a native dropdown
              that long is unusable for finding a code anyway. Typing
              filters; the action resolves the code and reports an
              unrecognised one plainly. */}
          <datalist id="course-codes">
            {courses.map((c) => (
              <option key={c.id} value={c.code}>
                {c.title}
              </option>
            ))}
          </datalist>
          <div>
            <Label className="text-xs" htmlFor="prereq-course">
              Course
            </Label>
            <Input id="prereq-course" name="courseCode" list="course-codes" required placeholder="CSC 201" className="w-40" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="prereq-of">
              Requires
            </Label>
            <Input id="prereq-of" name="prerequisiteCourseCode" list="course-codes" required placeholder="CSC 101" className="w-40" />
          </div>
          <SubmitButton pendingLabel="Adding…">Add prerequisite</SubmitButton>
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
                  <Td className="font-mono text-xs text-fg-secondary">{courseCode(p.courseId)}</Td>
                  <Td className="font-mono text-xs text-fg-secondary">{courseCode(p.prerequisiteCourseId)}</Td>
                  <Td>
                    <form action={removePrerequisiteAction}>
                      <input type="hidden" name="courseId" value={p.courseId} />
                      <input type="hidden" name="prerequisiteCourseId" value={p.prerequisiteCourseId} />
                      <SubmitTextButton className="font-medium text-danger-fg hover:underline">
                        Remove
                      </SubmitTextButton>
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
