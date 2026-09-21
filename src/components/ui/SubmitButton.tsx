"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";

/**
 * Submit buttons that say they are working.
 *
 * Every mutating form in this app posts to a Server Action against a
 * database in another region -- measured at seconds, not milliseconds, per
 * round trip. Nothing in the UI used to acknowledge the click at all: the
 * button stayed enabled and idle, which reads as "the click didn't
 * register" and invites a second submit.
 *
 * A changed label alone turned out not to be enough. "Working…" is easy to
 * miss on a button you have just looked away from, and on the icon
 * controls in a table row there is no label to change. So there is a
 * spinner, in currentColor, which works on the green Approve, the red
 * Reject and the plain grey ones without any of them knowing about it.
 *
 * `useFormStatus` only reports the status of the form this button is
 * rendered inside, so each of these must live within its own `<form>` --
 * which is already how every form on these pages is built (one form per
 * action, no shared submit buttons).
 */

/** A ring that spins, sized to sit beside text. `currentColor` so it
 *  inherits whatever the button already is, and still on for anyone who
 *  asked for less motion -- the disabled state and label carry it there. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-4 w-4 shrink-0 rounded-full border-2 border-current border-t-transparent",
        "motion-safe:animate-spin",
        className,
      )}
    />
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: ButtonProps & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" aria-busy={pending || undefined} disabled={pending || disabled} {...props}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
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
        "inline-flex items-center gap-1.5",
        "disabled:cursor-not-allowed disabled:text-fg-subtle disabled:no-underline",
        className,
      )}
      {...props}
    >
      {pending && <Spinner className="h-3.5 w-3.5" />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

/**
 * For a submit that carries its own styling and its own icon -- the tinted
 * Approve/Reject pair on the review screen, the quiet glyphs beside them.
 * The icon is a prop rather than a child so the spinner can take its
 * place: swapping the icon keeps the button exactly the same width, where
 * inserting a spinner next to it would make the row twitch at the moment
 * somebody is watching it.
 */
export function SubmitIconButton({
  icon,
  children,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-busy={pending || undefined}
      disabled={pending || disabled}
      className={cn(className, "disabled:cursor-not-allowed disabled:opacity-60")}
      {...props}
    >
      {pending ? <Spinner /> : icon}
      {children}
    </button>
  );
}
