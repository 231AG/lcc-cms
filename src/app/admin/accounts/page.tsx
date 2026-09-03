import type { Metadata } from "next";
import { ne } from "drizzle-orm";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { appUser } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { CreateAccountForm } from "./CreateAccountForm";
import { disableAccountAction, enableAccountAction } from "./actions";

export const metadata: Metadata = { title: "Admin accounts" };

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
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  }

  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
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
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Admin accounts" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <CreateAccountForm />

      <h2 className="mb-3 font-medium text-fg">Existing accounts</h2>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Name</Th>
              <Th>Username</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </Thead>
          <tbody>
            {staffAccounts.map((row) => (
              <Tr key={row.id}>
                <Td className="font-medium text-fg">{row.displayName}</Td>
                <Td>{row.loginIdentifier}</Td>
                <Td>{row.role}</Td>
                <Td>
                  <Badge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status}</Badge>
                </Td>
                <Td>
                  {row.status === "ACTIVE" ? (
                    <form action={disableAccountAction}>
                      <input type="hidden" name="targetUserId" value={row.id} />
                      <button type="submit" className="font-medium text-danger-fg hover:underline">
                        Disable
                      </button>
                    </form>
                  ) : (
                    <form action={enableAccountAction}>
                      <input type="hidden" name="targetUserId" value={row.id} />
                      <button type="submit" className="font-medium text-success-fg hover:underline">
                        Enable
                      </button>
                    </form>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </main>
  );
}
