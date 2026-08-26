import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudent } from "@/lib/students/students";
import { asUser } from "@/lib/db/asUser";

/**
 * Landing page. Students see S-09 (their own read-only profile, plan
 * Section 20.3) as of Stage 5; Admin/Super Admin still see the Stage 2
 * placeholder -- their own home pages (A-01/X-01) are built as those
 * stages land.
 */
export default async function PortalPage() {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect("/login");
  }

  if (actor.mustChangePassword) {
    redirect("/change-password");
  }

  if (actor.role === "STUDENT") {
    const record = await getStudent(actor, actor.userId);
    const department = await asUser(actor.userId, (tx) =>
      tx.query.department.findFirst({ where: (d, { eq }) => eq(d.id, record.departmentId) }),
    );

    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="mb-2 text-xl font-semibold">
          {record.firstName} {record.lastName}
        </h1>
        <p className="mb-6 text-sm text-gray-500">Student ID {record.studentNumber}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Department</dt>
          <dd>{department ? `${department.code} — ${department.name}` : "—"}</dd>
          <dt className="text-gray-500">Enrolment year</dt>
          <dd>{record.enrolmentYear}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd>{record.status}</dd>
          <dt className="text-gray-500">Import status</dt>
          <dd>{record.historicalImportStatus}</dd>
        </dl>
        {record.historicalImportStatus !== "COMPLETE" && (
          <p className="mt-4 text-xs text-gray-500">
            Your academic history is still being entered by the Admin office -- not everything may
            appear here yet.
          </p>
        )}
        <p className="mt-6 text-sm">
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </p>
      </main>
    );
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
