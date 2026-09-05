import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-subtle text-fg-secondary border-line",
  brand: "bg-brand-subtle text-brand-fg border-brand-line",
  success: "bg-success-surface text-success-fg border-success-line",
  warning: "bg-warning-surface text-warning-fg border-warning-line",
  danger: "bg-danger-surface text-danger-fg border-danger-line",
  info: "bg-info-surface text-info-fg border-info-line",
};

/**
 * A small status pill. The app has several independent status enums
 * (grade DRAFT/PUBLISHED/LOCKED, semester Draft/Open/..., correction
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
