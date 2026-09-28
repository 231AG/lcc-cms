import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A small label that appears under an icon-only control on hover or
 * keyboard focus. CSS only -- no client JavaScript -- so it works in the
 * server-rendered shell like everything else there.
 *
 * The bubble is `aria-hidden`: every control it wraps already carries an
 * `aria-label` with the same words, so a screen reader hears the name once,
 * from the control, and the tooltip is purely for sighted users.
 *
 * `align` keeps the bubble on screen: controls at the right edge of the
 * page align its right edge with theirs rather than centring past the
 * viewport.
 *
 * `className` sets the wrapper's display (default `inline-flex`), so a
 * control shown at only one breakpoint hides its wrapper along with it.
 */
export function Tooltip({
  label,
  children,
  align = "center",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative", className ?? "inline-flex")}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "bg-fg text-surface pointer-events-none absolute top-full z-50 mt-2 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md",
          "opacity-0 transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 group-hover/tip:delay-300",
          align === "start" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "end" && "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
