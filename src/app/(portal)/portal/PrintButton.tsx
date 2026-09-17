"use client";

import { Printer } from "lucide-react";
import { logSemesterPrintAction } from "./actions";

/** Icon-only action button -- kept in step with the one in page.tsx and with
 *  the Students and Offerings tables. */
const iconAction =
  "inline-flex rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** S-04's Print action (Section 20.3/20.4) -- logs the print event, then
 * hands off to the browser's own print dialog against the page's print
 * stylesheet (DER-24: a dedicated print stylesheet over server-rendered
 * HTML, not a client-side PDF library).
 *
 * An icon rather than the word, matching every other print control in the
 * portal. The title and the accessible name carry the meaning for anyone the
 * icon does not reach. */
export default function PrintButton({ semesterId }: { semesterId: string }) {
  return (
    <button
      type="button"
      title="Print (PDF)"
      aria-label="Print (PDF)"
      className={`${iconAction} print:hidden`}
      onClick={async () => {
        await logSemesterPrintAction(semesterId);
        window.print();
      }}
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
