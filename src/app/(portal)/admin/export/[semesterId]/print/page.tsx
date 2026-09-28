import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { countUnpublishedGrades, runSemesterResultsExport } from "@/lib/export/academicExport";
import {
  SEMESTER_RESULT_PRINT_COLUMNS,
  semesterResultPrintRows,
  semesterResultsFootNote,
} from "@/lib/export/semesterExportRows";
import { AppError } from "@/lib/errors";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PrintReport } from "@/components/print/PrintReport";
import { PrintNowButton } from "../../../students/print/PrintNowButton";

export const metadata: Metadata = { title: "Print semester results" };

/**
 * The semester-results file as a printable document on the College
 * letterhead -- the same PrintReport shell the Student Listing and Course
 * Offerings print views use, so "Print / Save as PDF" gives the registrar
 * a paper copy that matches the CSV row for row.
 *
 * Opening this page is itself an export -- the data leaves the system on
 * paper instead of in a file -- so it is audited exactly like the CSV.
 */
export default async function PrintSemesterResultsPage({ params }: { params: Promise<{ semesterId: string }> }) {
  const { semesterId } = await params;
  const actor = await getCurrentActor();

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

  let result: Awaited<ReturnType<typeof runSemesterResultsExport>>;
  try {
    result = await runSemesterResultsExport(actor, semesterId, "PRINT");
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="danger">{err.message}</Alert>
      </main>
    );
  }
  const { context, rows } = result;
  const unpublished = await countUnpublishedGrades(semesterId);

  const printRows = semesterResultPrintRows(rows);
  const footNote = semesterResultsFootNote(unpublished);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-6 outline-none print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">Semester results — print preview</h1>
          <p className="text-sm text-fg-muted">{context.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintNowButton />
          <Link href="/admin/export" className={buttonClasses("ghost", "md")}>
            Back to Semester export
          </Link>
        </div>
      </div>

      {unpublished > 0 && (
        <Alert tone="warning" className="mb-4 print:hidden">
          {unpublished} registered {unpublished === 1 ? "student" : "students"} in this semester still{" "}
          {unpublished === 1 ? "has" : "have"} no published grade. Their results below are not final.
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg bg-white p-6 shadow-sm print:overflow-visible print:rounded-none print:p-0 print:shadow-none">
        <PrintReport
          title="SEMESTER RESULTS"
          subtitle={context.label}
          columns={SEMESTER_RESULT_PRINT_COLUMNS}
          rows={printRows}
          rowNoun="student"
          footNote={footNote}
          emptyMessage="No results have been recorded for this semester yet."
        />
      </div>
    </main>
  );
}
