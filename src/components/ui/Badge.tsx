import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  success: "bg-success-50 text-success-800 border-success-200",
  warning: "bg-warning-50 text-warning-800 border-warning-200",
  danger: "bg-danger-50 text-danger-800 border-danger-200",
  info: "bg-info-50 text-info-800 border-info-200",
};

/**
 * A small status pill. The app has several independent status enums
 * (grade DRAFT/PUBLISHED/LOCKED, semester OPEN/REGISTRATION/..., correction
 * PENDING/APPROVED/REJECTED, historical import status, ...) -- rather than
 * one giant string->tone lookup table coupling them all together, each
 * call site maps its own status string to a `Tone` with a small local
 * function/switch, and passes the result here. Renders the exact status
 * text unchanged (constraint 2: no renamed statuses), just styled.
 */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
