import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Historical import progress" };

/**
 * A-16 placeholder -- the full progress report (status/college/department/
 * cohort breakdowns, flagged issues) is parked pending a redesign; the nav
 * item and route stay live, this just shows a simple "coming soon" state
 * instead of the retired report.
 */
export default async function ImportProgressPage() {
  const actor = await getCurrentActor();

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Historical import progress" />
      <Alert tone="info">Coming soon.</Alert>
    </main>
  );
}
