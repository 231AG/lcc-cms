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
import { StudentsHeader } from "./AddStudentPanel";
import { StudentsTable, type StudentRow } from "./StudentsTable";

export const metadata: Metadata = { title: "Students" };

const PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

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
  searchParams: Promise<{
    q?: string;
    status?: string;
    departmentId?: string;
    year?: string;
    page?: string;
    pageSize?: string;
    error?: string;
  }>;
}) {
  const actor = await getCurrentActor();
  const { q, status, departmentId, year, page, pageSize, error } = await searchParams;

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

  // Only values the app really defines: statuses from STUDENT_STATUSES,
  // departments from the department table, years derived from the
  // enrolment_year column that already exists. Nothing invented, nothing
  // hardcoded.
  const validStatus =
    status && (STUDENT_STATUSES as readonly string[]).includes(status) ? (status as (typeof STUDENT_STATUSES)[number]) : undefined;
  const validYear = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
  const size = PAGE_SIZES.includes(Number(pageSize) as (typeof PAGE_SIZES)[number]) ? Number(pageSize) : DEFAULT_PAGE_SIZE;
  const pageNum = Math.max(1, Number(page) || 1);

  const [results, departments, enrolmentYears] = await Promise.all([
    searchStudents(actor, { query: q, status: validStatus, departmentId: departmentId || undefined, enrolmentYear: validYear, page: pageNum, pageSize: size }),
    asUser(actor.userId, (tx) =>
      tx.query.department.findMany({ where: (d, { eq }) => eq(d.isActive, true), orderBy: (d, { asc }) => asc(d.code) }),
    ),
    getEnrolmentYears(actor),
  ]);

  const departmentName = (id: string) => {
    const d = departments.find((d) => d.id === id);
    return d ? `${d.code} — ${d.name}` : id;
  };

  const rows: StudentRow[] = results.rows.map((s) => ({
    id: s.id,
    studentNumber: s.studentNumber,
    firstName: s.firstName,
    lastName: s.lastName,
    status: s.status,
    departmentName: departmentName(s.departmentId),
    enrolmentYear: s.enrolmentYear,
  }));

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));
  const hasFilters = Boolean(q || validStatus || departmentId || validYear);
  const firstShown = results.total === 0 ? 0 : (pageNum - 1) * results.pageSize + 1;
  const lastShown = Math.min(pageNum * results.pageSize, results.total);

  // Pagination must carry every active filter, or paging would silently
  // widen the result set. The filter form itself omits `page`, so changing
  // any filter resets to page 1 by construction rather than by a rule
  // someone has to remember.
  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (validStatus) sp.set("status", validStatus);
    if (departmentId) sp.set("departmentId", departmentId);
    if (validYear) sp.set("year", String(validYear));
    if (size !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(size));
    if (p > 1) sp.set("page", String(p));
    return `/admin/students${sp.toString() ? `?${sp}` : ""}`;
  };

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
          <Link href="/admin/historical/progress" className="text-sm font-medium text-brand-fg hover:underline">
            Historical import progress
          </Link>
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
          <div>
            <Label htmlFor="departmentId" className="text-xs">
              Department
            </Label>
            <Select id="departmentId" name="departmentId" defaultValue={departmentId ?? ""} className="max-w-56">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
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
              {q && <input type="hidden" name="q" value={q} />}
              {validStatus && <input type="hidden" name="status" value={validStatus} />}
              {departmentId && <input type="hidden" name="departmentId" value={departmentId} />}
              {validYear && <input type="hidden" name="year" value={String(validYear)} />}
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
