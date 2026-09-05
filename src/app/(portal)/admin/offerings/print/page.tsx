import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { OFFERING_COLUMNS } from "@/lib/offerings/offeringRows";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PrintReport } from "@/components/print/PrintReport";
import { PrintNowButton } from "../../students/print/PrintNowButton";
import { describeOfferingFilters, getFilteredOfferingRows, type OfferingViewParams } from "../offeringFilters";

export const metadata: Metadata = { title: "Print course offerings" };

/**
 * The offerings table as a printable, multi-page document with the College
 * letterhead -- same header treatment as the grade sheet, same pagination
 * rules as the student listing print view (see PrintReport).
 */
export default async function PrintOfferingsPage({ searchParams }: { searchParams: Promise<OfferingViewParams> }) {
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

  const { rows, semesterLabel, collegeLabel } = await getFilteredOfferingRows(actor, params);
  const backSearch = new URLSearchParams();
  if (params.semesterId) backSearch.set("semesterId", params.semesterId);
  if (params.q) backSearch.set("q", params.q);
  if (params.collegeId) backSearch.set("collegeId", params.collegeId);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">Course offerings — print preview</h1>
          <p className="text-sm text-fg-muted">{describeOfferingFilters(semesterLabel, params.q, collegeLabel)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintNowButton />
          <Link href={`/admin/offerings?${backSearch}`} className={buttonClasses("ghost", "md")}>
            Back to offerings
          </Link>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none">
        <PrintReport
          title="COURSE OFFERINGS"
          subtitle={describeOfferingFilters(semesterLabel, params.q, collegeLabel)}
          columns={OFFERING_COLUMNS}
          rows={rows}
          emptyMessage="No offering matches these filters."
        />
      </div>
    </main>
  );
}
