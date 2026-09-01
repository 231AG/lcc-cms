import type { ReactNode } from "react";
import { cn } from "./cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, string> = {
  info: "border-info-200 bg-info-50 text-info-800",
  success: "border-success-200 bg-success-50 text-success-800",
  warning: "border-warning-200 bg-warning-50 text-warning-800",
  danger: "border-danger-200 bg-danger-50 text-danger-800",
};

/**
 * Replaces the ad hoc `rounded border border-amber-300 bg-amber-50 ...`
 * strings repeated across the app (provisional-data warnings, error
 * banners, plan-status notices) with one consistent component. Purely
 * presentational -- takes whatever text a page already renders.
 */
export function Alert({ tone = "info", children, className }: { tone?: AlertTone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}
