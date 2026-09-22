import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { Label, Input } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { passwordPolicyFor } from "@/lib/identity/passwordPolicy";
import { changePasswordAction } from "./actions";

export const metadata: Metadata = { title: "Change password" };

/**
 * S-02 (plan Section 20.3). Reachable whether or not a change is forced --
 * REQ-A03's "unbypassable" requirement is enforced centrally in
 * src/proxy.ts (Stage 11), not by hiding this page.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  if (!actor) {
    redirect("/login");
  }

  const { error } = await searchParams;

  // The same policy the server action enforces, rendered as a hint before
  // anything is typed rather than only as an error afterwards. Students
  // get the simple rule; staff keep the 10-character minimum.
  const policy = passwordPolicyFor(actor.role);
  // Sentence-cased for standalone use; the policy text itself is written
  // to read as a clause ("at least 6 characters, including ...").
  const policyHint = policy.description.charAt(0).toUpperCase() + policy.description.slice(1) + ".";

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-12 outline-none">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
            <KeyRound className="h-6 w-6 text-brand-fg" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold text-fg">Change your password</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {actor.mustChangePassword
              ? "You must set a new password before continuing."
              : `Signed in as ${actor.displayName}.`}
          </p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          {error === "1" && (
            <Alert tone="danger" className="mb-4">
              Passwords must match and be {policy.description}.
            </Alert>
          )}
          {error === "2" && (
            <Alert tone="danger" className="mb-4">
              That password is too easy to guess. Choose something less common.
            </Alert>
          )}

          {error === "3" && (
            <Alert tone="danger" className="mb-4">
              That is not your current password.
            </Alert>
          )}
          <form action={changePasswordAction} className="flex flex-col gap-4">
            {/* Only on the self-service path. A forced change (first login,
                or straight after an Admin reset) is already gated by the
                temporary password the user just signed in with, and asking
                for it twice in the same minute is friction with no gain. */}
            {!actor.mustChangePassword && (
              <div>
                <Label htmlFor="currentPassword">Current password</Label>
                <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
              </div>
            )}
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={policy.minLength}
                autoComplete="new-password"
                aria-describedby="password-rules"
              />
              <p id="password-rules" className="mt-1 text-xs text-fg-muted">
                {policyHint}
              </p>
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={policy.minLength} autoComplete="new-password" />
            </div>
            <SubmitButton className="mt-2 w-full">
              Set password
            </SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
