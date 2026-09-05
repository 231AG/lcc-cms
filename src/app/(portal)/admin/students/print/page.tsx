import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudentListRows, STUDENT_LIST_COLUMNS } from "@/lib/students/studentListRows";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PrintReport } from "@/components/print/PrintReport";
import { describeFilters, filterSearchParams, parseStudentFilters, type StudentListParams } from "../filters";
import { PrintNowButton } from "./PrintNowButton";

export const metadata: Metadata = { title: "Print student listing" };

/**
 * The Students listing as a printable, multi-page document.
 *
 * Reads the same query string as the listing through the same parser, so it
 * prints exactly what is on screen -- every filter and the search box,
 * across every page. Everything except the report itself is `print:hidden`.
 */
export default async function PrintStudentsPage({ searchParams }: { searchParams: Promise<StudentListParams> }) {
  const actor = await getCurrentActor();
  const params = await searchParams;

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

  const filters = parseStudentFilters(params);
  const { rows, truncated, collegeName } = await getStudentListRows(actor, filters);
  const backHref = `/admin/students${filterSearchParams(filters).toString() ? `?${filterSearchParams(filters)}` : ""}`;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 outline-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">Student listing — print preview</h1>
          <p className="text-sm text-fg-muted">{describeFilters(filters, collegeName)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintNowButton />
          <Link href={backHref} className={buttonClasses("ghost", "md")}>
            Back to listing
          </Link>
        </div>
      </div>

      {truncated && (
        <Alert tone="warning" className="mb-4 print:hidden">
          Only the first {rows.length} students are included. Narrow the filters to print the rest.
        </Alert>
      )}

      <div className="rounded-lg bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none">
        <PrintReport
          title="STUDENT LISTING"
          subtitle={describeFilters(filters, collegeName)}
          columns={STUDENT_LIST_COLUMNS}
          rows={rows}
          emptyMessage="No student matches these filters."
        />
      </div>
    </main>
  );
}
