import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudent } from "@/lib/students/students";
import { asUser } from "@/lib/db/asUser";

const ADMIN_LINKS = [
  { href: "/admin/students", label: "Students" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/structure", label: "Academic structure" },
  { href: "/admin/calendar", label: "Academic calendar" },
];

const SUPER_ADMIN_LINKS = [
  { href: "/admin/accounts", label: "Admin accounts" },
  { href: "/admin/students", label: "Students (read-only)" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/calendar", label: "Academic calendar (read-only)" },
];

/**
 * Landing page. Students see S-09 (their own read-only profile, plan
 * Section 20.3) as of Stage 5. Admin/Super Admin see the Stage 2
 * placeholder plus a plain list of the screens available to their role --
 * full role-specific dashboards (A-01/X-01) are their own later screens,
 * but every stage since 2 has shipped a real admin page with no way to
 * reach it except typing the URL, which is a genuine dead end.
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

  const links = actor.role === "SUPER_ADMIN" ? SUPER_ADMIN_LINKS : ADMIN_LINKS;

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-xl font-semibold">Signed in</h1>
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd>{actor.displayName}</dd>
        <dt className="text-gray-500">Login identifier</dt>
        <dd>{actor.loginIdentifier}</dd>
        <dt className="text-gray-500">Role</dt>
        <dd>{actor.role}</dd>
      </dl>
      <ul className="flex flex-col gap-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-blue-700 underline">
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </li>
      </ul>
    </main>
  );
}
