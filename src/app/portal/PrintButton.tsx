"use client";

import { logSemesterPrintAction } from "./actions";

/** S-04's Print action (Section 20.3/20.4) -- logs the print event, then
 * hands off to the browser's own print dialog against the page's print
 * stylesheet (DER-24: a dedicated print stylesheet over server-rendered
 * HTML, not a client-side PDF library). */
export default function PrintButton({ semesterId }: { semesterId: string }) {
  return (
    <button
      type="button"
      className="text-xs font-medium text-brand-700 hover:underline print:hidden"
      onClick={async () => {
        await logSemesterPrintAction(semesterId);
        window.print();
      }}
    >
      Print
    </button>
  );
}
