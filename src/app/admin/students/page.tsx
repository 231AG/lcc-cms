import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { searchStudents, STUDENT_STATUSES } from "@/lib/students/students";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Label, Input, Select } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { EnrollStudentForm } from "./EnrollStudentForm";

export const metadata: Metadata = { title: "Students" };

/**
 * A-09 (Admin: search, enrol, quick links to edit) and X-07 (Super Admin:
 * same search, read-only -- Section 20.5/20.6) combined onto one page, the
 * same "one page, role-conditional controls" pattern /admin/calendar
 * already uses for Admin vs Super Admin.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { q, status, page, error } = await searchParams;

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

  const pageNum = Math.max(1, Number(page) || 1);
  const [results, departments] = await Promise.all([
    searchStudents(actor, {
      query: q,
      status: status && (STUDENT_STATUSES as readonly string[]).includes(status) ? (status as (typeof STUDENT_STATUSES)[number]) : undefined,
      page: pageNum,
    }),
    actor.role === "ADMIN"
      ? asUser(actor.userId, (tx) => tx.query.department.findMany({ where: (d, { eq }) => eq(d.isActive, true), orderBy: (d, { asc }) => asc(d.code) }))
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title="Students"
        actions={
          <Link href="/admin/historical/progress" className="text-sm font-medium text-brand-fg hover:underline">
            Historical import progress
          </Link>
        }
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {actor.role === "ADMIN" && <EnrollStudentForm departments={departments.map((d) => ({ id: d.id, code: d.code, name: d.name }))} />}

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="q" className="text-xs">
            Search
          </Label>
          <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Student ID or name" className="w-56" />
        </div>
        <div>
          <Label htmlFor="status" className="text-xs">
            Status
          </Label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Student ID</Th>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Enrolment year</Th>
              <Th>Import status</Th>
              <Th></Th>
            </tr>
          </Thead>
          <tbody>
            {results.rows.map((s) => (
              <Tr key={s.id}>
                <Td className="font-mono text-xs text-fg-secondary">{s.studentNumber}</Td>
                <Td className="font-medium text-fg">
                  {s.lastName}, {s.firstName}
                </Td>
                <Td>{s.status}</Td>
                <Td>{s.enrolmentYear}</Td>
                <Td>{s.historicalImportStatus}</Td>
                <Td>
                  {actor.role === "ADMIN" ? (
                    <span className="flex gap-3">
                      <Link href={`/admin/students/${s.id}?mode=view`} className="font-medium text-brand-fg hover:underline">
                        View
                      </Link>
                      <Link href={`/admin/students/${s.id}`} className="font-medium text-brand-fg hover:underline">
                        Edit
                      </Link>
                    </span>
                  ) : (
                    <Link href={`/admin/students/${s.id}`} className="font-medium text-brand-fg hover:underline">
                      View
                    </Link>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {results.rows.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">
          {q || status ? "No students match this search." : "No students enrolled yet."}
        </p>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {pageNum > 1 && (
            <Link
              href={`/admin/students?q=${encodeURIComponent(q ?? "")}&status=${encodeURIComponent(status ?? "")}&page=${pageNum - 1}`}
              className="font-medium text-brand-fg hover:underline"
            >
              Previous
            </Link>
          )}
          <span className="text-fg-secondary">
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link
              href={`/admin/students?q=${encodeURIComponent(q ?? "")}&status=${encodeURIComponent(status ?? "")}&page=${pageNum + 1}`}
              className="font-medium text-brand-fg hover:underline"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
