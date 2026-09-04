"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";

/**
 * A submit button that disables itself and says so while its form is in
 * flight.
 *
 * Every mutating form in this app posts to a Server Action against a
 * database in another region -- measured at seconds, not milliseconds, per
 * round trip. Before this existed, nothing in the UI acknowledged the
 * click at all: the button stayed enabled and idle, which reads as "the
 * click didn't register" and invites a second submit. (EnrollStudentForm
 * was the sole exception, via useActionState's own `pending`.)
 *
 * `useFormStatus` only reports the status of the form this button is
 * rendered inside, so each of these must live within its own `<form>` --
 * which is already how every form on these pages is built (one form per
 * action, no shared submit buttons).
 */
export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: ButtonProps & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" aria-busy={pending || undefined} disabled={pending || disabled} {...props}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}

/**
 * The same behaviour for the small inline text submits used inside table
 * rows and lists ("Remove", "Deactivate", "Add"), which are plain
 * `<button>`s styled as links rather than Buttons.
 */
export function SubmitTextButton({
  children,
  pendingLabel,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-busy={pending || undefined}
      disabled={pending || disabled}
      className={cn(
        "disabled:cursor-not-allowed disabled:text-neutral-400 disabled:no-underline",
        className,
      )}
      {...props}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
