import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { listExportableSemesters } from "@/lib/export/academicExport";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { SemesterExportTable } from "./SemesterExportTable";

export const metadata: Metadata = { title: "Semester export" };

/**
 * Section 11.3's "Run the semester-end export" -- Admin and Super Admin
 * both hold this permission (unlike the audit log, which is Super
 * Admin-only).
 *
 * One row per semester, newest first, with what an export of it would
 * hold and the two files it can produce. The downloads are plain GET
 * routes so the browser gets real Content-Disposition/Content-Type
 * headers, not a Server Action; the printed results are an ordinary page
 * with the College letterhead.
 */
export default async function ExportPage() {
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

  const semesters = await listExportableSemesters(actor);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "Semester export" }]} />
      <PageHeader
        title="Semester export"
        description="Download a semester's final grades and results. A copy of the College's academic data leaves the system with every file, so each download and each print is recorded in the audit log."
      />

      <SemesterExportTable semesters={semesters} />
    </main>
  );
}
