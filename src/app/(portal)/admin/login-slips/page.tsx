import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { can } from "@/lib/permissions/kernel";
import { listLoginSlipStudents, MAX_SLIPS_PER_PRINT } from "@/lib/identity/loginSlips";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { LoginSlipsManager } from "./LoginSlipsManager";

export const metadata: Metadata = { title: "Login slips" };

/**
 * Students' sign-in details on paper. Admin only -- the same permission as
 * resetting a student's password, which is what printing a slip does
 * (src/lib/identity/loginSlips.ts).
 */
export default async function LoginSlipsPage() {
  const actor = await getCurrentActor();

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (!(await can(actor, "identity.resetStudentPassword"))) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const students = await listLoginSlipStudents(actor);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 outline-none print:max-w-none print:p-0">
      <div className="print:hidden">
        <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "Login slips" }]} />
        <PageHeader
          title="Login slips"
          description="Print students' Student IDs and temporary passwords on slips to cut and hand out. Printing issues a new temporary password, shown only on this print; the student's previous temporary password stops working."
        />
      </div>
      <LoginSlipsManager students={students} maxPerPrint={MAX_SLIPS_PER_PRINT} />
    </main>
  );
}
