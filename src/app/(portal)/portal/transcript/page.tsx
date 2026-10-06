import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getTranscript } from "@/lib/transcript/transcript";
import { Alert } from "@/components/ui/Alert";
import { buttonClasses } from "@/components/ui/Button";
import { TranscriptDocument } from "@/components/transcript/TranscriptDocument";
import { PrintTranscriptButton } from "@/components/transcript/PrintTranscriptButton";
import { logOwnTranscriptPrintAction } from "../actions";

export const metadata: Metadata = { title: "My transcript" };

/**
 * The student's own transcript, as an UNOFFICIAL copy.
 *
 * The same document and the same figures as the College's official one --
 * one component, so the two cannot disagree -- but marked UNOFFICIAL on
 * every page and without the signature line: a student can print their
 * record, not certify it.
 *
 * Scoped to the signed-in student's own id, never a path or query
 * parameter, and read through row-level security on top of that.
 */
export default async function OwnTranscriptPage() {
  const actor = await getCurrentActor();

  if (!actor) {
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  }
  if (actor.role !== "STUDENT") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">
          This is a student&rsquo;s own transcript. To print one for a student, use{" "}
          <Link href="/admin/transcripts" className="font-medium underline">
            Transcripts
          </Link>
          .
        </Alert>
      </main>
    );
  }

  const data = await getTranscript(actor, actor.userId);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 outline-none print:max-w-none print:p-0"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-fg">My transcript</h1>
          <p className="text-sm text-fg-muted">
            An unofficial copy for your own use. For an official transcript, ask the Office of Admissions and Records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintTranscriptButton logPrint={logOwnTranscriptPrintAction} />
          <Link href="/portal" className={buttonClasses("ghost", "md")}>
            Back
          </Link>
        </div>
      </div>

      {data.isProvisional && (
        <Alert tone="warning" className="mb-4 print:hidden">
          Your past records are still being entered, so this shows only what is on record so far.
        </Alert>
      )}

      <div className="overflow-x-auto pb-2 print:overflow-visible print:pb-0">
        <TranscriptDocument data={data} unofficial />
      </div>
    </main>
  );
}
