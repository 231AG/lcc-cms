import type { Metadata } from "next";
import { getStudentLevels } from "@/lib/gpa/gpa";
import { StudentStatus } from "@/components/students/StudentStatus";
import Link from "next/link";
import { ArrowLeft, FileText, UserRound } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions/kernel";
import { searchStudents } from "@/lib/students/students";
import { listName } from "@/lib/students/name";
import { getTranscript } from "@/lib/transcript/transcript";
import { TranscriptDocument } from "@/components/transcript/TranscriptDocument";
import { PrintTranscriptButton } from "@/components/transcript/PrintTranscriptButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { logTranscriptPrintAction } from "./actions";

export const metadata: Metadata = { title: "Transcripts" };

const PAGE_SIZE = 10;

/**
 * Official academic transcripts: choose a student, see their transcript,
 * print it or save it as a PDF.
 *
 * Reached from the sidebar and from the Transcript button on a student's
 * profile, which links straight to `?studentId=`. Staff only -- Admin and
 * Super Admin, the two roles that can already read any student's record;
 * a student prints their own unofficial copy from /portal/transcript.
 *
 * Everything but the document is `print:hidden`, so the printer gets the
 * transcript pages and nothing else.
 */
export default async function TranscriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; sq?: string; sp?: string }>;
}) {
  const actor = await getCurrentActor();
  const { studentId, sq, sp } = await searchParams;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">
          Not available to your role. Your own transcript is under{" "}
          <Link href="/portal/transcript" className="font-medium underline">
            My transcript
          </Link>
          .
        </Alert>
      </main>
    );
  }

  if (!studentId) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8">
        <PageHeader
          title="Transcripts"
          description="Choose a student to see their official academic transcript, then print it or save it as a PDF."
        />
        <StudentPicker actor={actor} sq={sq} sp={sp} />
      </main>
    );
  }

  let data;
  try {
    data = await getTranscript(actor, studentId);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Student not found.</Alert>
      </main>
    );
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 outline-none print:max-w-none print:p-0"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">Transcript — {data.student.name}</h1>
          <p className="text-sm text-fg-muted">
            A4, landscape. Choose &ldquo;Save as PDF&rdquo; in the print dialog to keep a copy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintTranscriptButton logPrint={logTranscriptPrintAction.bind(null, data.student.id)} />
          <Link href={`/admin/students/${data.student.id}?mode=view`} className={buttonClasses("secondary", "md", "group")}>
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            Student profile
          </Link>
        </div>
      </div>

      {data.isProvisional && (
        <Alert tone="warning" className="mb-4 print:hidden">
          This student&rsquo;s past records are not all entered yet, so the transcript shows only what is on record so
          far.
        </Alert>
      )}

      {/* A fixed physical width: on a narrow screen it scrolls in its own
          box rather than making the whole page scroll sideways. */}
      <div className="overflow-x-auto pb-2 print:overflow-visible print:pb-0">
        <TranscriptDocument data={data} />
      </div>
    </main>
  );
}

/** Step one: which student. The same search-and-list shape as Student grades. */
async function StudentPicker({ actor, sq, sp }: { actor: Actor; sq?: string; sp?: string }) {
  const pageNum = Math.max(1, Number(sp) || 1);
  const results = await searchStudents(actor, { query: sq?.trim() || undefined, page: pageNum, pageSize: PAGE_SIZE });
  const levels = await getStudentLevels(actor, results.rows.map((s) => s.id));
  const departments = results.rows.length ? await asUser(actor.userId, (tx) => tx.query.department.findMany()) : [];
  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";

  const pageHref = (p: number) =>
    `/admin/transcripts?${new URLSearchParams({ ...(sq ? { sq } : {}), ...(p > 1 ? { sp: String(p) } : {}) }).toString()}`;
  const lastPage = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const firstOnPage = results.total === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const lastOnPage = (pageNum - 1) * PAGE_SIZE + results.rows.length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle icon={<UserRound className="h-4 w-4" aria-hidden="true" />}>Choose a student</CardTitle>
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <Label htmlFor="sq" className="sr-only">
            Search students
          </Label>
          <div className="w-56">
            <Input id="sq" name="sq" defaultValue={sq ?? ""} placeholder="Student ID or name" />
          </div>
          <SubmitButton variant="secondary">Search</SubmitButton>
          {sq && (
            <Link href="/admin/transcripts" className="text-xs font-medium text-brand-fg hover:underline">
              Clear
            </Link>
          )}
        </form>
      </CardHeader>
      <CardBody>
        {results.rows.length === 0 ? (
          <p className="text-sm text-fg-muted">{sq ? <>No students match &ldquo;{sq}&rdquo;.</> : "No students on record yet."}</p>
        ) : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th className="whitespace-nowrap">Student ID</Th>
                  <Th>Name</Th>
                  <Th className="hidden sm:table-cell">Department</Th>
                  <Th className="hidden whitespace-nowrap sm:table-cell">Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </Thead>
              <tbody>
                {results.rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-mono text-xs whitespace-nowrap text-fg-secondary">{s.studentNumber}</Td>
                    <Td className="font-medium text-fg">{listName(s)}</Td>
                    <Td className="hidden text-fg-secondary sm:table-cell">{departmentName(s.departmentId)}</Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">
                      <StudentStatus level={levels.get(s.id) ?? "FRESHMAN"} enrollment={s.status} />
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/admin/transcripts?studentId=${s.id}`}
                        className={buttonClasses("primary", "sm", "gap-1.5")}
                        aria-label={`Transcript — ${listName(s)}`}
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        Transcript
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">
                Showing {firstOnPage}–{lastOnPage} of {results.total} student{results.total === 1 ? "" : "s"}
                {sq && <> matching &ldquo;{sq}&rdquo;</>}
              </p>
              {lastPage > 1 && (
                <div className="flex items-center gap-2">
                  {pageNum > 1 && (
                    <Link href={pageHref(pageNum - 1)} className={buttonClasses("secondary", "sm")}>
                      Previous
                    </Link>
                  )}
                  <span className="text-xs text-fg-muted">
                    Page {pageNum} of {lastPage}
                  </span>
                  {pageNum < lastPage && (
                    <Link href={pageHref(pageNum + 1)} className={buttonClasses("secondary", "sm")}>
                      Next
                    </Link>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
