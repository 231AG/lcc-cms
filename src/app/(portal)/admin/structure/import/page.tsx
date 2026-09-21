import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { listDepartmentsForImport } from "@/lib/courses/courseImport";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import CourseImportForm from "./CourseImportForm";

export const metadata: Metadata = { title: "Import courses" };

/**
 * Loading the catalogue.
 *
 * The College's 800-odd courses live in a PDF, and entering them one at a
 * time through Academic structure was never realistic. This takes the
 * pasted list instead.
 *
 * Admin only, like everything else under structure: a Super Admin is
 * denied structure.manageCourse outright (REQ-R04), and this screen is
 * not a way around that.
 */
export default async function ImportCoursesPage() {
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

  const departments = await listDepartmentsForImport(actor);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8"
    >
      <Breadcrumb items={[{ label: "Academic structure", href: "/admin/structure" }, { label: "Import courses" }]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Import courses" className="mb-0" />
        <Link href="/admin/structure" className={buttonClasses("secondary", "md", "group gap-1.5")}>
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
          Back to structure
        </Link>
      </div>

      {departments.length === 0 ? (
        <Alert tone="warning">
          There are no departments yet, and every course belongs to one. Add them on{" "}
          <Link href="/admin/structure" className="font-medium underline">
            Academic structure
          </Link>{" "}
          first, then come back.
        </Alert>
      ) : (
        <CourseImportForm departments={departments.map((d) => ({ id: d.id, code: d.code, name: d.name }))} />
      )}
    </main>
  );
}
