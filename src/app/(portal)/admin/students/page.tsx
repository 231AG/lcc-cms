import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { getEnrolmentYears, searchStudents, STUDENT_STATUSES } from "@/lib/students/students";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Label, Input, Select } from "@/components/ui/Form";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { Download, Printer } from "lucide-react";
import { StudentsHeader } from "./AddStudentPanel";
import { StudentsTable, type StudentRow } from "./StudentsTable";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  filterSearchParams,
  parseStudentFilters,
  type StudentListParams,
} from "./filters";

export const metadata: Metadata = { title: "Student Listing" };

/** Icon controls carry a tooltip and an accessible name; this is their look. */
const iconAction =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * A-09 (Admin: search, enrol, quick links to edit) and X-07 (Super Admin:
 * same search, read-only -- Section 20.5/20.6) combined onto one page, the
 * same "one page, role-conditional controls" pattern /admin/calendar
 * already uses for Admin vs Super Admin.
 *
 * The interface was rebuilt in the student-listing redesign pass; the data
 * flow underneath was NOT. searchStudents() is the same server-side,
 * RLS-scoped, paginated query it has been since Stage 5 -- it gained two
 * optional filter fields and nothing else. Enrolment, editing, viewing,
 * the View/Edit split, validation and routing are all reused as they were.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<StudentListParams & { error?: string }>;
}) {
  const actor = await getCurrentActor();
  const params = await searchParams;
  const { q, collegeId, error } = params;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }
  const isAdmin = actor.role === "ADMIN";

  // Parsed by the same function the CSV route and the print view use, so
  // "the export respects the current filters" is structurally true rather
  // than three separate implementations agreeing by luck.
  const filters = parseStudentFilters(params);
  const { status: validStatus, enrolmentYear: validYear, pageSize: size, page: pageNum, hasFilters } = filters;

  // Departments are still fetched -- the enrolment form enrols INTO a
  // department, and the listing needs the department -> college mapping to
  // label each row -- but the column and the filter are the college now.
  const [results, colleges, departments, enrolmentYears] = await Promise.all([
    searchStudents(actor, filters),
    asUser(actor.userId, (tx) =>
      tx.query.college.findMany({ where: (c, { eq }) => eq(c.isActive, true), orderBy: (c, { asc }) => asc(c.code) }),
    ),
    asUser(actor.userId, (tx) =>
      tx.query.department.findMany({ where: (d, { eq }) => eq(d.isActive, true), orderBy: (d, { asc }) => asc(d.code) }),
    ),
    getEnrolmentYears(actor),
  ]);

  // The college's NAME, without its code. The code is an internal key; on a
  // listing a reader is scanning for "Faculty of Science & Technology", and
  // the "FST — " prefix in front of every row is noise they have to look
  // past. It is still what the filter dropdown is keyed on, just not shown.
  const collegeLabel = (id: string) => colleges.find((c) => c.id === id)?.name ?? id;
  // A student's college is reached through their department. An inactive
  // department (or one from an inactive college) is not in either list, so
  // fall back to the raw id rather than showing an empty cell.
  const collegeForStudent = (departmentId: string) => {
    const d = departments.find((d) => d.id === departmentId);
    return d ? collegeLabel(d.collegeId) : departmentId;
  };

  const rows: StudentRow[] = results.rows.map((s) => ({
    id: s.id,
    studentNumber: s.studentNumber,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    status: s.status,
    collegeName: collegeForStudent(s.departmentId),
    enrolmentYear: s.enrolmentYear,
  }));

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));
  const firstShown = results.total === 0 ? 0 : (pageNum - 1) * results.pageSize + 1;
  const lastShown = Math.min(pageNum * results.pageSize, results.total);

  // Pagination must carry every active filter, or paging would silently
  // widen the result set. The filter form itself omits `page`, so changing
  // any filter resets to page 1 by construction rather than by a rule
  // someone has to remember.
  const hrefForPage = (p: number) => {
    const sp = filterSearchParams(filters);
    if (size !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(size));
    if (p > 1) sp.set("page", String(p));
    return `/admin/students${sp.toString() ? `?${sp}` : ""}`;
  };

  // Export and print act on the whole filtered set, not the page on screen,
  // so they carry the filters and deliberately drop `page`/`pageSize`.
  const exportQuery = filterSearchParams(filters).toString();
  const exportHref = `/admin/students/export${exportQuery ? `?${exportQuery}` : ""}`;
  const printHref = `/admin/students/print${exportQuery ? `?${exportQuery}` : ""}`;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:py-10">
      <StudentsHeader
        canEnrol={isAdmin}
        departments={departments.map((d) => ({ id: d.id, code: d.code, name: d.name }))}
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-fg">Students Information</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {results.total} student{results.total === 1 ? "" : "s"}
              {hasFilters ? " matching the current filters" : " enrolled"}
            </p>
          </div>
          {/* Icon-only, with a tooltip and a matching accessible name on
              each. Both act on every row matching the current filters,
              across every page -- not just what is on screen, and not the
              whole unfiltered table. */}
          <div className="flex flex-wrap items-center gap-1">
            <a href={exportHref} title="Export to CSV" aria-label="Export to CSV" className={iconAction}>
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link href={printHref} title="Print (PDF)" aria-label="Print (PDF)" className={iconAction}>
              <Printer className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <form method="GET" className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3 sm:px-5">
          <div className="grow sm:grow-0">
            <Label htmlFor="q" className="text-xs">
              Search
            </Label>
            <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Search students..." className="w-full sm:w-64" />
          </div>
          <div>
            <Label htmlFor="status" className="text-xs">
              Status
            </Label>
            <Select id="status" name="status" defaultValue={validStatus ?? ""}>
              <option value="">All statuses</option>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {/* College, not Department: there are far fewer colleges than
              departments, so this is the dimension an admin can actually
              scan a list by. Department-level detail lives on the student's
              profile page. */}
          <div>
            <Label htmlFor="collegeId" className="text-xs">
              College
            </Label>
            {/* Applies as soon as a college is chosen -- see the
                `data-auto-submit` handler in public/enhance.js. The Apply
                button below stays: it is what the search box uses, and it
                is the whole control if scripts are blocked. */}
            <Select id="collegeId" name="collegeId" defaultValue={collegeId ?? ""} className="max-w-56" data-auto-submit="">
              <option value="">All colleges</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {/* Skipped entirely when there is nothing behind it -- an empty
              database would otherwise show a filter that can only ever
              return nothing. */}
          {enrolmentYears.length > 0 && (
            <div>
              <Label htmlFor="year" className="text-xs">
                Enrolment year
              </Label>
              <Select id="year" name="year" defaultValue={validYear ? String(validYear) : ""}>
                <option value="">All years</option>
                {enrolmentYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="pageSize" value={size} />}
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {hasFilters && (
            <Link href="/admin/students" className={buttonClasses("ghost", "md")}>
              Clear filters
            </Link>
          )}
        </form>

        {rows.length > 0 ? (
          <StudentsTable students={rows} canEdit={isAdmin} />
        ) : (
          <div className="px-4 py-12 text-center sm:px-5">
            <p className="text-sm font-medium text-fg">No students found</p>
            {hasFilters ? (
              <>
                <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
                  No student matches the current search and filters.
                </p>
                <Link href="/admin/students" className={buttonClasses("secondary", "md", "mt-4")}>
                  Clear filters
                </Link>
              </>
            ) : (
              <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
                {isAdmin
                  ? 'No students are enrolled yet. Use "Add Student" above to enrol the first one.'
                  : "No students are enrolled yet."}
              </p>
            )}
          </div>
        )}
      </Card>

      {results.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-secondary">
            Showing {firstShown}&ndash;{lastShown} of {results.total} student{results.total === 1 ? "" : "s"}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <form method="GET" className="flex items-center gap-1.5">
              {[...filterSearchParams(filters)].map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Label htmlFor="pageSize" className="mb-0 text-xs whitespace-nowrap">
                Per page
              </Label>
              <Select id="pageSize" name="pageSize" defaultValue={String(size)} className="w-20 py-1 text-xs">
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" size="sm">
                Set
              </Button>
            </form>

            <Pagination page={pageNum} totalPages={totalPages} hrefForPage={hrefForPage} label="Students pagination" />
          </div>
        </div>
      )}
    </main>
  );
}
