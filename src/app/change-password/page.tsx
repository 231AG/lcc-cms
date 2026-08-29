import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/session";
import { changePasswordAction } from "./actions";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Change your password</h1>
      <p className="mb-6 text-sm text-gray-600">
        {actor.mustChangePassword
          ? "You must set a new password before continuing."
          : `Signed in as ${actor.displayName}.`}
      </p>

      {error === "1" && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Passwords must match and be at least 10 characters.
        </p>
      )}
      {error === "2" && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          That password is too easy to guess. Choose something less common.
        </p>
      )}

      <form action={changePasswordAction} className="flex flex-col gap-4">
        <div>
          <label htmlFor="newPassword" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white"
        >
          Set password
        </button>
      </form>
    </main>
  );
}
