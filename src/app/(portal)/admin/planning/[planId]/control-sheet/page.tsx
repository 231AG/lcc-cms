import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getControlSheet } from "@/lib/planning/controlSheet";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { PrintReport } from "@/components/print/PrintReport";
import { PrintNowButton } from "@/app/(portal)/admin/students/print/PrintNowButton";

export const metadata: Metadata = { title: "Control Sheet" };

const COLUMNS = [
  { key: "code", header: "Course Code", nowrap: true },
  { key: "title", header: "Course Title" },
  { key: "section", header: "Sec", nowrap: true },
  { key: "creditHours", header: "Cr/Hrs", nowrap: true },
  { key: "days", header: "Day", nowrap: true },
  { key: "room", header: "Room", nowrap: true },
  { key: "time", header: "Time", nowrap: true },
] as const;

/**
 * The student's copy of what they are registered for.
 *
 * Portrait, unlike the other print views: seven columns, not twelve, and a
 * control sheet handed to a student reads like a form rather than a
 * spreadsheet.
 */
export default async function ControlSheetPage({ params }: { params: Promise<{ planId: string }> }) {
  const actor = await getCurrentActor();
  const { planId } = await params;

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

  const sheet = await getControlSheet(actor, planId);
  const totalLabel = `${sheet.totalCreditHours} Cr/Hrs`;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6 outline-none sm:px-6 print:max-w-none print:p-0"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-fg text-lg font-semibold">Control Sheet — print preview</h1>
          <p className="text-fg-muted text-sm">
            {sheet.studentName} · {sheet.semesterName} · {totalLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintNowButton />
          <Link href={`/admin/planning/${planId}`} className={buttonClasses("ghost", "md")}>
            Back to review
          </Link>
        </div>
      </div>

      {sheet.courses.length === 0 && (
        <Alert tone="warning" className="mb-4 print:hidden">
          No course on this plan has been approved, so the sheet is empty. A control sheet lists what the student is
          registered for.
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg bg-white p-6 shadow-sm print:overflow-visible print:rounded-none print:p-0 print:shadow-none">
        <PrintReport
          title="CONTROL SHEET"
          orientation="portrait"
          meta={[
            { label: "Student Name", value: sheet.studentName },
            { label: "Student ID", value: sheet.studentNumber },
            { label: "Major", value: sheet.major },
            { label: "Semester", value: sheet.semesterName },
          ]}
          columns={COLUMNS}
          rows={sheet.courses.map((c) => ({ ...c, creditHours: String(c.creditHours) }))}
          emptyMessage="No approved courses on this plan."
          footNote={`Total ${totalLabel}`}
          rowNoun="course"
        />
      </div>
    </main>
  );
}
