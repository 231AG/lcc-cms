import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Thin styling wrappers around real form elements. Every prop (name, id,
 * required, defaultValue, aria-label, onChange for the rare client form,
 * ...) passes straight through via spread -- these change appearance only,
 * never what a `formData.get(...)` reads server-side (constraint 8) or an
 * element's accessible name/role (constraint 2).
 */

const fieldBase =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 " +
  "placeholder:text-neutral-400 focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100 " +
  "disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-neutral-800", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, className)} {...props} />;
}

/** Label + control wrapper for the common "one field, one label, spaced from the next" case. */
export function FormField({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}
