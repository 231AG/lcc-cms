import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** One layer above the page background: `surface` sits a step lighter than
 * `background` in dark mode, so the page -> section -> card hierarchy reads
 * from layered lightness rather than from a heavier border or shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(16_12_32_/_0.04),0_8px_24px_-12px_rgb(16_12_32_/_0.12)]", className)}
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
export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-base font-bold text-fg", className)}>{children}</h2>;
}
