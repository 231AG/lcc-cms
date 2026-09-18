import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getGradeSheet } from "@/lib/gradesheet/gradeSheet";
import { NotFoundError } from "@/lib/errors";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { GradeSheetDocument } from "@/components/gradesheet/GradeSheetDocument";
import { PrintOwnGradeSheet } from "./PrintOwnGradeSheet";

export const metadata: Metadata = { title: "Grade sheet" };

/**
 * The student's own grade sheet for one semester, as the printed document.
 *
 * The same GradeSheetDocument the Registrar prints from /admin, with the
 * same figures out of the same getGradeSheet() -- deliberately one
 * component and not a student-flavoured copy of it. A grade sheet is a
 * record of what happened; the student's copy and the office's copy of the
 * same semester have to be the same piece of paper, and two components
 * would be two things to keep in step.
 *
 * Scoping is the signed-in student's own id, never a path parameter: there
 * is no studentId in this route to tamper with, and getGradeSheet reads
 * through row-level security on top of that.
 *
 * Everything but the document is `print:hidden`, so what leaves the
 * printer is the sheet and nothing else.
 */
export default async function OwnGradeSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ semesterId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const actor = await getCurrentActor();
  const { semesterId } = await params;
  const { print } = await searchParams;

  if (!actor) {
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  }
  // Staff print from the student's profile, where they choose whose sheet
  // it is; this route only ever knows one student, the reader.
  if (actor.role !== "STUDENT") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">
          This is your own grade sheet. To print a student&rsquo;s, open their profile under Students.
        </Alert>
      </main>
    );
  }

  let data;
  try {
    data = await getGradeSheet(actor, actor.userId, semesterId);
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

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 outline-none print:max-w-none print:p-0"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">
            Grade sheet — {data.academicYearLabel} {data.semesterName}
          </h1>
          <p className="text-sm text-fg-muted">A4, landscape. Choose &ldquo;Save as PDF&rdquo; in the dialog to keep a copy.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintOwnGradeSheet semesterId={semesterId} auto={print === "1"} />
          <Link href="/portal" className={buttonClasses("ghost", "md")}>
            Back
          </Link>
        </div>
      </div>

      {/* The sheet is A4-landscape at a fixed physical size, so on a narrow
          screen it scrolls in its own box rather than making the whole page
          scroll sideways. */}
      <div className="overflow-x-auto print:overflow-visible">
        <GradeSheetDocument data={data} />
      </div>
    </main>
  );
}
