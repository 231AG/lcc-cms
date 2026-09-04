import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

// Disabled styling is a muted neutral surface + muted text rather than a
// dimmed brand colour (`opacity-50` on a purple button just reads as a paler
// purple, which still looks clickable). `disabled:` utilities carry a
// pseudo-class so they outrank the variant's own background regardless of the
// order the classes are concatenated in.
const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring " +
  "disabled:cursor-not-allowed disabled:border-disabled-line disabled:bg-disabled-surface disabled:text-disabled-fg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  // Outlined, not a neutral fill: a plain white/near-white button overpowers
  // the surrounding UI in dark mode.
  secondary:
    "bg-secondary-surface text-secondary-fg border border-secondary-line " +
    "hover:bg-secondary-surface-hover hover:border-secondary-line-hover active:bg-secondary-surface-active",
  danger: "bg-danger-solid text-on-solid hover:bg-danger-solid-hover active:bg-danger-solid-active",
  ghost: "bg-transparent text-brand-fg hover:bg-brand-subtle",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

/**
 * Shared button styling as a plain string generator, so the same visual
 * language works on a real `<button>` (via the `Button` component below)
 * and on a `next/link` `<Link>` styled as a button -- several pages use a
 * Link where the destination is a real navigation, not a form submit, and
 * constraint 2 requires it stay a real `<a>` in that case, not a
 * button-shaped div. Use `buttonClasses(...)` directly on a `<Link>` for
 * that case.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}
