import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
  secondary:
    "bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100",
  danger: "bg-danger-600 text-white hover:bg-danger-800 active:bg-danger-800",
  ghost: "bg-transparent text-brand-700 hover:bg-brand-50",
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
