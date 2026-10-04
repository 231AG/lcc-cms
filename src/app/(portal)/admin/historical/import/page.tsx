import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, PenLine, UserRound } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { getStudent, searchStudents } from "@/lib/students/students";
import { fullName, listName } from "@/lib/students/name";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { cn } from "@/components/ui/cn";
import GradeSheetImportForm from "./GradeSheetImportForm";
import ManualEntryForm, { type ManualEntryFormProps } from "./ManualEntryForm";

export const metadata: Metadata = { title: "Import past grades" };

const PAGE_SIZE = 10;

/**
 * Past grade sheets, two ways in: a CSV of many sheets, or one student's
 * semester typed in by hand from the paper (added 4 Oct 2026).
 *
 * Admin only: entering a historical record is an Admin permission, and a
 * Super Admin is denied it outright (REQ-R04). Both tabs go through the
 * same service (enterHistoricalSemester) for every grade they save.
 */
export default async function ImportPastGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; studentId?: string; sq?: string; sp?: string }>;
}) {
  const actor = await getCurrentActor();
  const { tab, studentId, sq, sp } = await searchParams;

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

  const byHand = tab === "hand";

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8"
    >
      <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "Import past grades" }]} />
      <PageHeader
        title="Import past grades"
        description={
          byHand
            ? "Enter one student's past semester from the paper grade sheet. Grade points and the GPA are worked out from the grades; anything that disagrees with the paper is shown before you save."
            : "Upload the grade-sheet CSV. Every sheet is checked against the student records, the course catalogue, the academic calendar and its own printed GPA, and only sheets that pass every check are imported."
        }
      />

      <nav aria-label="How to add past grades" className="border-line mb-6 flex gap-1 border-b">
        <TabLink href="/admin/historical/import" active={!byHand} icon={<FileUp className="h-4 w-4" aria-hidden="true" />}>
          Upload CSV
        </TabLink>
        <TabLink href="/admin/historical/import?tab=hand" active={byHand} icon={<PenLine className="h-4 w-4" aria-hidden="true" />}>
          Enter by hand
        </TabLink>
      </nav>

      {!byHand ? (
        <GradeSheetImportForm />
      ) : studentId ? (
        <ManualEntry actor={actor} studentId={studentId} />
      ) : (
        <StudentPicker actor={actor} sq={sq} sp={sp} />
      )}
    </main>
  );
}

function TabLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
        active ? "border-brand text-brand-fg" : "text-fg-muted hover:text-fg border-transparent",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Step one: which student
// ---------------------------------------------------------------------------

async function StudentPicker({ actor, sq, sp }: { actor: Actor; sq?: string; sp?: string }) {
  const pageNum = Math.max(1, Number(sp) || 1);
  const results = await searchStudents(actor, { query: sq?.trim() || undefined, page: pageNum, pageSize: PAGE_SIZE });
  const departments = results.rows.length ? await asUser(actor.userId, (tx) => tx.query.department.findMany()) : [];
  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const base = "/admin/historical/import?tab=hand";
  const pageHref = (p: number) => `${base}${sq ? `&sq=${encodeURIComponent(sq)}` : ""}${p > 1 ? `&sp=${p}` : ""}`;
  const lastPage = Math.max(1, Math.ceil(results.total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle icon={<UserRound className="h-4 w-4" aria-hidden="true" />}>Choose a student</CardTitle>
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="hand" />
          <Label htmlFor="sq" className="sr-only">
            Search students
          </Label>
          <div className="w-56">
            <Input id="sq" name="sq" defaultValue={sq ?? ""} placeholder="Student ID or name" />
          </div>
          <SubmitButton variant="secondary">Search</SubmitButton>
          {sq && (
            <Link href={base} className="text-brand-fg text-xs font-medium hover:underline">
              Clear
            </Link>
          )}
        </form>
      </CardHeader>
      <CardBody>
        {results.rows.length === 0 ? (
          <p className="text-fg-muted text-sm">{sq ? <>No students match &ldquo;{sq}&rdquo;.</> : "No students on record yet."}</p>
        ) : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th className="whitespace-nowrap">Student ID</Th>
                  <Th>Name</Th>
                  <Th className="hidden sm:table-cell">Department</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </Thead>
              <tbody>
                {results.rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="text-fg-secondary font-mono text-xs whitespace-nowrap">{s.studentNumber}</Td>
                    <Td className="text-fg font-medium">{listName(s)}</Td>
                    <Td className="text-fg-secondary hidden sm:table-cell">{departmentName(s.departmentId)}</Td>
                    <Td className="text-right">
                      <Link
                        href={`${base}&studentId=${s.id}`}
                        className={buttonClasses("primary", "sm", "whitespace-nowrap")}
                        aria-label={`Enter grades — ${listName(s)}`}
                      >
                        Enter grades
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {lastPage > 1 && (
              <div className="mt-4 flex items-center justify-end gap-2">
                {pageNum > 1 && (
                  <Link href={pageHref(pageNum - 1)} className={buttonClasses("secondary", "sm")}>
                    Previous
                  </Link>
                )}
                <span className="text-fg-muted text-xs">
                  Page {pageNum} of {lastPage}
                </span>
                {pageNum < lastPage && (
                  <Link href={pageHref(pageNum + 1)} className={buttonClasses("secondary", "sm")}>
                    Next
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step two: the semester and its courses
// ---------------------------------------------------------------------------

async function ManualEntry({ actor, studentId }: { actor: Actor; studentId: string }) {
  let record;
  try {
    record = await getStudent(actor, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) return <Alert tone="info">Student not found.</Alert>;
    throw err;
  }

  const [departments, courses, years, semesters, records, scale] = await asUser(actor.userId, (tx) =>
    Promise.all([
      tx.query.department.findMany({ columns: { id: true, name: true, isActive: true } }),
      tx.query.course.findMany({ columns: { code: true, title: true, creditHours: true } }),
      tx.query.academicYear.findMany(),
      tx.query.semester.findMany(),
      tx.query.academicRecord.findMany({
        where: (r, { and, eq }) => and(eq(r.studentId, studentId), eq(r.isVoid, false)),
        columns: { semesterId: true },
      }),
      tx.query.gradeScale.findMany({ where: (g, { lte }) => lte(g.effectiveFrom, new Date()) }),
    ]),
  );

  const version = Math.max(0, ...scale.map((g) => g.policyVersion));
  const grades = scale
    .filter((g) => g.policyVersion === version)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((g) => ({ letter: g.letter, gradePoint: g.gradePoint === null ? null : Number(g.gradePoint), countsInGpa: g.countsInGpa, legacy: g.isLegacy }));

  // Every year from the one the student enrolled in to this one, and any
  // other the calendar holds from then on.
  const now = new Date();
  const labels = new Set<string>();
  for (let y = record.enrolmentYear; y <= now.getFullYear(); y++) labels.add(`${y}/${y + 1}`);
  for (const y of years) {
    const start = Number(/^(\d{4})\//.exec(y.label)?.[1]);
    if (start >= record.enrolmentYear) labels.add(y.label);
  }
  const countBySemester = new Map<string, number>();
  for (const r of records) countBySemester.set(r.semesterId, (countBySemester.get(r.semesterId) ?? 0) + 1);

  const yearOptions: ManualEntryFormProps["years"] = [...labels].sort().map((label) => {
    const year = years.find((y) => y.label === label);
    return {
      label,
      inCalendar: Boolean(year),
      semesters: ([1, 2] as const).map((sequence) => {
        const sem = year ? semesters.find((s) => s.academicYearId === year.id && s.sequence === sequence) : undefined;
        return {
          sequence,
          inCalendar: Boolean(sem),
          ended: sem ? new Date(sem.endDate) < now : null,
          grades: sem ? (countBySemester.get(sem.id) ?? 0) : 0,
        };
      }),
    };
  });

  const department = departments.find((d) => d.id === record.departmentId);

  return (
    <ManualEntryForm
      key={record.id}
      student={{
        id: record.id,
        name: fullName(record),
        studentNumber: record.studentNumber,
        departmentId: record.departmentId,
        departmentName: department?.name ?? "—",
        enrolmentYear: record.enrolmentYear,
      }}
      years={yearOptions}
      courses={courses.map((c) => ({ code: c.code, title: c.title, creditHours: c.creditHours }))}
      departments={departments.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name))}
      grades={grades}
    />
  );
}
