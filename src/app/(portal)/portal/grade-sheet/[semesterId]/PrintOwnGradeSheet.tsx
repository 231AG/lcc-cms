"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { logSemesterPrintAction } from "../../actions";

/**
 * Print / Save as PDF for the student's own grade sheet.
 *
 * There is no PDF library here, on purpose (DER-24, DEV-17): the browser's
 * own print dialog turns this exact markup into a real A4 landscape PDF
 * with selectable text, at zero bundle cost. A client-side renderer would
 * ship hundreds of kilobytes to produce a second copy of a layout that
 * could then drift from the printed one.
 *
 * Which is why there is ONE control and not a Print beside a Download.
 * Both would open this same dialog, and what separates printing from saving
 * happens inside it, on a Destination menu no page is allowed to preset --
 * browsers forbid that, or any site could push files at you. Two buttons
 * would promise a difference the software cannot deliver; one that names
 * both outcomes tells the truth.
 *
 * The print is logged before the dialog opens -- that is the moment a copy
 * of the record starts leaving the system (Section 20.4).
 */
export function PrintOwnGradeSheet({ semesterId, auto }: { semesterId: string; auto: boolean }) {
  const fired = useRef(false);

  const print = async () => {
    await logSemesterPrintAction(semesterId);
    window.print();
  };

  useEffect(() => {
    // Once per mount. React 18's development double-invoke would otherwise
    // log two prints and open two dialogs for one click.
    if (!auto || fired.current) return;
    fired.current = true;
    void print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <button type="button" className={buttonClasses("primary", "md")} onClick={print}>
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}
