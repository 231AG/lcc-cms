import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/session";

/**
 * Placeholder landing page for Stage 2 -- proves the login -> forced
 * password change -> authenticated session loop end to end. Role-specific
 * home pages (S-03 / A-01 / X-01) are built as their stages land.
 */
export default async function PortalPage() {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect("/login");
  }

  if (actor.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-xl font-semibold">Signed in</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd>{actor.displayName}</dd>
        <dt className="text-gray-500">Login identifier</dt>
        <dd>{actor.loginIdentifier}</dd>
        <dt className="text-gray-500">Role</dt>
        <dd>{actor.role}</dd>
      </dl>
    </main>
  );
}
