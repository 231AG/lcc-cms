import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getCurrentActor } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
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
              Passwords must match and be at least 10 characters.
            </Alert>
          )}
          {error === "2" && (
            <Alert tone="danger" className="mb-4">
              That password is too easy to guess. Choose something less common.
            </Alert>
          )}

          <form action={changePasswordAction} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" />
            </div>
            <Button type="submit" className="mt-2 w-full">
              Set password
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
