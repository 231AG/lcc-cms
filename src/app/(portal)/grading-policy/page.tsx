import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { getGradingPolicy } from "@/lib/grading/policy";
import { GradingPolicyContent } from "@/components/grading/GradingPolicyContent";

export const metadata: Metadata = { title: "Grading policy" };

/**
 * X-08 (plan Section 20.5) -- available to every signed-in role
 * (Student/Admin/Super Admin all hold `gradingPolicy.view`). Placed
 * outside /admin since a Student needs to reach it too.
 */
export default async function GradingPolicyPage() {
  const actor = await getCurrentActor();
  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );

  const policy = await getGradingPolicy(actor);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none">
      {/* Students see the rules they are graded under; office configuration
          (grade-sheet signatories, time zone, feature switches) is for staff. */}
      <GradingPolicyContent policy={policy} showConfiguration={actor.role !== "STUDENT"} />
    </main>
  );
}
