import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Consistent page-title block: an `<h1>` (exact text unchanged from
 * before, per constraint 2) plus an optional description and an optional
 * actions slot (buttons/links that belong at the top of the page).
 *
 * `eyebrow` is the small uppercase line above the title in the design
 * reference. It is optional and additive -- a page that does not pass one
 * looks exactly as it did, so this did not have to be threaded through
 * twenty-nine callers to land.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-7 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-fg-muted mb-1.5 text-[11px] font-bold tracking-[0.12em] uppercase">{eyebrow}</p>
        )}
        <h1 className="text-fg text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {description && <p className="text-fg-secondary mt-1.5 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
