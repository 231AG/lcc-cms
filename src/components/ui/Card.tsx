import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** One layer above the page background: `surface` sits a step lighter than
 * `background` in dark mode, so the page -> section -> card hierarchy reads
 * from layered lightness rather than from a heavier border or shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line-subtle px-4 py-3 sm:px-5", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}

/** Section heading used inside a Card/section -- keeps the `<h2 class="font-medium">`
 * convention already used throughout the app, just with consistent sizing. */
export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-sm font-semibold text-fg", className)}>{children}</h2>;
}
