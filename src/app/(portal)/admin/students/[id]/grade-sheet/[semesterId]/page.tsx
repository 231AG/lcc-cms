import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { can } from "@/lib/permissions/kernel";
import { getGradeSheet } from "@/lib/gradesheet/gradeSheet";
import { NotFoundError } from "@/lib/errors";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { GradeSheetDocument } from "@/components/gradesheet/GradeSheetDocument";
import { PrintGradeSheetButton } from "./PrintGradeSheetButton";
import { updateSignatoriesAction } from "./actions";

export const metadata: Metadata = { title: "Grade sheet" };

/**
 * One student's grade sheet for one semester, as the printable document.
 *
 * Reached from the Academic history card on the student's profile -- one
 * link per semester that actually has results, so the sheet is always
 * opened for a semester there is something to print.
 *
 * Everything except the document itself is `print:hidden`: the app header
 * (already hidden by the shared Header), the toolbar, and the signatory
 * editor. What comes out of the printer is the sheet and nothing else.
 */
export default async function GradeSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; semesterId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { id, semesterId } = await params;
  const { error } = await searchParams;

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

  let data;
  try {
    data = await getGradeSheet(actor, id, semesterId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
          <Alert tone="info">{err.message}</Alert>
        </main>
      );
    }
    throw err;
  }

  // Deny-by-default: on an installation whose seed has not been re-run this
  // permission simply does not exist yet, `can` returns false, and the
  // editor is absent rather than the page failing. The sheet still prints
  // with the stored (or default) names either way.
  const canEditSignatories = await can(actor, "institution.manageSignatories");

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 outline-none print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">
            Grade sheet — {data.academicYearLabel} {data.semesterName}
          </h1>
          <p className="text-sm text-fg-muted">
            {data.student.name} &middot; <span className="font-mono text-xs">{data.student.studentNumber}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintGradeSheetButton studentId={id} semesterId={semesterId} />
          <Link href={`/admin/students/${id}?mode=view`} className={buttonClasses("ghost", "md")}>
            Back to student
          </Link>
        </div>
      </div>

      {error && (
        <Alert tone="danger" className="mb-4 print:hidden">
          {error}
        </Alert>
      )}

      {/* The sheet is A4-wide at a fixed physical size, so on a narrow
          screen it scrolls in its own box rather than making the whole page
          scroll sideways. */}
      <div className="overflow-x-auto print:overflow-visible">
        <GradeSheetDocument data={data} />
      </div>

      {canEditSignatories && (
        <details className="mt-6 rounded-lg border border-line bg-surface p-4 print:hidden">
          <summary className="cursor-pointer list-none text-sm font-medium text-brand-fg hover:underline">Edit signature block</summary>
          <p className="mt-2 text-xs text-fg-muted">
            These four values are institution settings, not part of this student&rsquo;s record — changing them changes every grade
            sheet printed from now on. The change is recorded in the audit log.
          </p>
          <form action={updateSignatoriesAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="studentId" value={id} />
            <input type="hidden" name="semesterId" value={semesterId} />
            <div>
              <Label htmlFor="signedName" className="text-xs">
                Signed — name
              </Label>
              <Input id="signedName" name="signedName" required defaultValue={data.signatories.signedName} />
            </div>
            <div>
              <Label htmlFor="signedTitle" className="text-xs">
                Signed — title
              </Label>
              <Input id="signedTitle" name="signedTitle" required defaultValue={data.signatories.signedTitle} />
            </div>
            <div>
              <Label htmlFor="approvedName" className="text-xs">
                Approved — name
              </Label>
              <Input id="approvedName" name="approvedName" required defaultValue={data.signatories.approvedName} />
            </div>
            <div>
              <Label htmlFor="approvedTitle" className="text-xs">
                Approved — title
              </Label>
              <Input id="approvedTitle" name="approvedTitle" required defaultValue={data.signatories.approvedTitle} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Save signature block</Button>
            </div>
          </form>
        </details>
      )}
    </main>
  );
}
