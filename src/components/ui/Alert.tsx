import type { ReactNode } from "react";
import { cn } from "./cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, string> = {
  info: "border-info-line bg-info-surface text-info-fg",
  success: "border-success-line bg-success-surface text-success-fg",
  warning: "border-warning-line bg-warning-surface text-warning-fg",
  danger: "border-danger-line bg-danger-surface text-danger-fg",
};

/**
 * Replaces the ad hoc per-page `border`/`bg` colour strings repeated across
 * the app (provisional-data warnings, error
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
