import { ne } from "drizzle-orm";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { appUser } from "@/lib/db/schema";
import { CreateAccountForm } from "./CreateAccountForm";
import { disableAccountAction, enableAccountAction } from "./actions";

/**
 * X-04 (plan Section 20.5). Super-Admin-only: create Admin/Super Admin
 * accounts, disable/enable them. Controls are hidden for any other role,
 * which is cosmetic -- assertCan() in the actions is the real enforcement
 * (Section 20.2's "permission denied" convention).
 */
export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { error } = await searchParams;

  if (!actor) {
    return <main className="p-8">Please sign in.</main>;
  }

  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
      </main>
    );
  }

  const staffAccounts = await asUser(actor.userId, (tx) =>
    tx.query.appUser.findMany({
      where: ne(appUser.role, "STUDENT"),
      orderBy: (row, { asc }) => asc(row.displayName),
    }),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Admin accounts</h1>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <CreateAccountForm />

      <h2 className="mb-3 font-medium">Existing accounts</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Name</th>
            <th className="py-2">Username</th>
            <th className="py-2">Role</th>
            <th className="py-2">Status</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {staffAccounts.map((row) => (
            <tr key={row.id} className="border-b">
              <td className="py-2">{row.displayName}</td>
              <td className="py-2">{row.loginIdentifier}</td>
              <td className="py-2">{row.role}</td>
              <td className="py-2">{row.status}</td>
              <td className="py-2">
                {row.status === "ACTIVE" ? (
                  <form action={disableAccountAction}>
                    <input type="hidden" name="targetUserId" value={row.id} />
                    <button type="submit" className="text-red-700 underline">
                      Disable
                    </button>
                  </form>
                ) : (
                  <form action={enableAccountAction}>
                    <input type="hidden" name="targetUserId" value={row.id} />
                    <button type="submit" className="text-green-700 underline">
                      Enable
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
