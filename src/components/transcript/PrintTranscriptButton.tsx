"use client";

import { Printer } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Print / Save as PDF for a transcript.
 *
 * The browser's own print dialog, as for the grade sheet: it turns the
 * page's markup into a real A4 landscape PDF with selectable text, and
 * saving versus printing is chosen inside that dialog, so one button names
 * both. `logPrint` is a server action that records the print before the
 * dialog opens.
 */
export function PrintTranscriptButton({ logPrint }: { logPrint: () => Promise<void> }) {
  return (
    <button
      type="button"
      className={buttonClasses("primary", "md", "print:hidden")}
      onClick={async () => {
        await logPrint();
        window.print();
      }}
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}
