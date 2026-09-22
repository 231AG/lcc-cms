import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** One layer above the page background: `surface` sits a step lighter than
 * `background` in dark mode, so the page -> section -> card hierarchy reads
 * from layered lightness rather than from a heavier border or shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface shadow-card", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line-subtle px-5 py-4 sm:px-6", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-5 sm:px-6", className)} {...props} />;
}

/** Section heading used inside a Card/section -- keeps the `<h2 class="font-medium">`
 * convention already used throughout the app, just with consistent sizing. */
/**
 * Section heading used inside a Card/section.
 *
 * `icon` is the small glyph beside the title in the design reference. It is
 * optional and decorative -- the heading text is the accessible name, and
 * the icon is hidden from assistive tech by the caller -- so a CardTitle
 * that passes none renders exactly as it did.
 */
export function CardTitle({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  if (!icon) return <h2 className={cn("text-base font-bold text-fg", className)}>{children}</h2>;
  return (
    <h2 className={cn("text-fg flex items-center gap-2.5 text-base font-bold", className)}>
      <span className="bg-brand-subtle text-brand-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
        {icon}
      </span>
      {children}
    </h2>
  );
}
