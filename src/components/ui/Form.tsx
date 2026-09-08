import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Thin styling wrappers around real form elements. Every prop (name, id,
 * required, defaultValue, aria-label, onChange for the rare client form,
 * ...) passes straight through via spread -- these change appearance only,
 * never what a `formData.get(...)` reads server-side (constraint 8) or an
 * element's accessible name/role (constraint 2).
 */

// Focus is a Deep Orchid border *plus* a 2px Lavender Haze ring. The ring is
// the part that carries the state -- a border colour shift on its own is close
// to invisible against a dark surface.
const fieldBase =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg " +
  "placeholder:text-fg-subtle focus:border-brand focus:outline focus:outline-2 focus:outline-focus-ring " +
  "disabled:cursor-not-allowed disabled:border-disabled-line disabled:bg-disabled-surface disabled:text-disabled-fg";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-fg", className)} {...props} />;
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

/**
 * The asterisk that marks a required field.
 *
 * `aria-hidden` with a visually-hidden word beside it, rather than a bare
 * "*": a screen reader announcing "star" tells nobody anything, and the
 * control's own `required` attribute is what assistive tech actually reads.
 * This is the sighted reader's half of the same fact.
 */
export function Required() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-danger-fg">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** Label + control wrapper for the common "one field, one label, spaced from the next" case. */
export function FormField({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}
