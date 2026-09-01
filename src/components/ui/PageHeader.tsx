import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Consistent page-title block: an `<h1>` (exact text unchanged from
 * before, per constraint 2) plus an optional description and an optional
 * actions slot (buttons/links that belong at the top of the page).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
