"use client";

import { Printer } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Opens the browser's print dialog, which is also how a PDF gets saved.
 * No PDF library: the browser already lays this table out and paginates it
 * (see PrintReport's @media print rules), and shipping a renderer to
 * duplicate that would cost hundreds of kilobytes to produce a worse file.
 */
export function PrintNowButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className={buttonClasses("primary", "md", "print:hidden")} onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
