import type { Metadata } from "next";
import { Download } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { countUnpublishedGrades } from "@/lib/export/academicExport";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Semester export" };

/**
 * Section 11.3's "Run the semester-end export" -- Admin and Super Admin
 * both hold this permission (unlike the audit log, which is Super
 * Admin-only). The actual download is a plain GET route so the browser
 * gets real Content-Disposition/Content-Type headers, not a Server Action.
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

  const [years, semesters] = await asUser(actor.userId, async (tx) => {
    return Promise.all([
      tx.query.academicYear.findMany({ orderBy: (row, { desc }) => desc(row.label) }),
      tx.query.semester.findMany({ orderBy: (row, { desc }) => [desc(row.academicYearId), desc(row.sequence)] }),
    ]);
  });

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? id;
  const unpublishedCounts = await Promise.all(semesters.map((s) => countUnpublishedGrades(s.id)));

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader
        title="Semester-end academic data export"
        description="A full copy of a semester's academic data leaves the system when you download it. Every export is recorded in the audit log."
      />

      {semesters.length === 0 && <p className="text-sm text-fg-muted">No semesters exist yet.</p>}

      <ul className="flex flex-col gap-2">
        {semesters.map((s, i) => {
          const unpublished = unpublishedCounts[i];
          return (
            <li key={s.id}>
              <Card>
                <CardBody className="flex flex-col gap-1 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-fg">
                      {yearLabel(s.academicYearId)} — {s.name} <span className="text-xs text-fg-muted">({s.state})</span>
                    </span>
                    <a href={`/admin/export/${s.id}`} className="flex items-center gap-1 text-sm font-medium text-brand-fg hover:underline">
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download CSV
                    </a>
                  </div>
                  {unpublished > 0 && (
                    <p className="text-xs text-warning-fg">
                      {unpublished} registered student{unpublished === 1 ? "" : "s"} in this semester still {unpublished === 1 ? "has" : "have"} no
                      published grade -- this export will not include a final result for them.
                    </p>
                  )}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
