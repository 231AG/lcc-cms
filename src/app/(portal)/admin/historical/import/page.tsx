import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import GradeSheetImportForm from "./GradeSheetImportForm";

export const metadata: Metadata = { title: "Import past grades" };

/**
 * Past grade sheets, imported from the CSV the extraction produces.
 *
 * Admin only: entering a historical record is an Admin permission, and a
 * Super Admin is denied it outright (REQ-R04). This screen is the same
 * permission as typing the records in by hand, and goes through the same
 * service (enterHistoricalSemester) for every sheet it imports.
 */
export default async function ImportPastGradesPage() {
  const actor = await getCurrentActor();

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

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8"
    >
      <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "Import past grades" }]} />
      <PageHeader
        title="Import past grades"
        description="Upload the grade-sheet CSV. Every sheet is checked against the student records, the course catalogue, the academic calendar and its own printed GPA, and only sheets that pass every check are imported."
      />
      <GradeSheetImportForm />
    </main>
  );
}
