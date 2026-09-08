"use client";

import { Printer } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { logGradeSheetPrintAction } from "./actions";

/**
 * Print / Save as PDF.
 *
 * There is no PDF library here on purpose (DER-24, and DEV-17's "the
 * semester grade sheet's print path stayed a @media print stylesheet over
 * server-rendered HTML"): the browser's own print dialog produces a real,
 * selectable-text A4 PDF from the same markup the screen shows, at zero
 * bundle cost. Adding a client-side renderer would ship hundreds of
 * kilobytes to duplicate a layout the browser already has.
 *
 * The print event is logged before the dialog opens, because that is the
 * moment a copy of the record starts leaving the system.
 */
export function PrintGradeSheetButton({ studentId, semesterId }: { studentId: string; semesterId: string }) {
  return (
    <button
      type="button"
      className={buttonClasses("primary", "md", "print:hidden")}
      onClick={async () => {
        await logGradeSheetPrintAction(studentId, semesterId);
        window.print();
      }}
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print / Save as PDF
    </button>
  );
}
