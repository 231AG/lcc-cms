import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { getAuditLogPage, AUDIT_PAGE_SIZE } from "@/lib/audit/query";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import Link from "next/link";

export const metadata: Metadata = { title: "Audit log" };

/**
 * X-06 (plan Section 20.5, REQ-R08) -- Super Admin only.
 *
 * Rebuilt as a real table, in the same shape as the redesigned Student
 * Listing: header/filter bar, purple-on-white table, and the shared
 * numbered pagination control instead of the old Newer/Older pair.
 *
 * The one thing that had to survive the change is the grouping. Entries
 * written by a single transaction share a request_id, and a batch approval
 * of 60 grades is 60 rows -- which as a flat table is 60 lines of noise
 * rather than one event. So a group's first row carries the marker and its
 * remaining rows are indented under it: the table stays a table (sortable
 * columns, scannable dates, one row per entry) while still saying which
 * entries were one action.
 *
 * Filters remain plain GET params so a filtered view has a shareable URL.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; action?: string; entityType?: string; from?: string; to?: string; page?: string }>;
}) {
  const actor = await getCurrentActor();
  const params = await searchParams;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const filters = {
    studentId: params.studentId?.trim() || undefined,
    action: params.action?.trim() || undefined,
    entityType: params.entityType?.trim() || undefined,
    occurredFrom: params.from ? new Date(params.from) : undefined,
    occurredTo: params.to ? new Date(params.to) : undefined,
  };
  const page = Math.max(1, Number(params.page) || 1);

  const { groups, total } = await getAuditLogPage(actor, filters, page);
  const hasFilters = Boolean(filters.studentId || filters.action || filters.entityType || filters.occurredFrom || filters.occurredTo);

  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const firstShown = total === 0 ? 0 : (page - 1) * AUDIT_PAGE_SIZE + 1;

  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k !== "page" && v) sp.set(k, String(v));
    }
    if (p > 1) sp.set("page", String(p));
    return `/admin/audit${sp.toString() ? `?${sp}` : ""}`;
  };

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Audit log" description="Viewing this page is itself recorded in the log." />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-fg">Recorded activity</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {total} entr{total === 1 ? "y" : "ies"}
              {hasFilters ? " matching the current filters" : " recorded"}
            </p>
          </div>
        </div>

        <form method="GET" className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3 sm:px-5">
          <div>
            <Label htmlFor="action" className="text-xs">
              Action
            </Label>
            {/* Applies on choice, like the Students listing's College filter. */}
            <Select id="action" name="action" defaultValue={params.action ?? ""} className="max-w-64" data-auto-submit="">
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="entityType" className="text-xs">
              Entity type
            </Label>
            <Input id="entityType" name="entityType" defaultValue={params.entityType} className="w-40" />
          </div>
          <div>
            <Label htmlFor="studentId" className="text-xs">
              Student ID (internal)
            </Label>
            <Input id="studentId" name="studentId" defaultValue={params.studentId} className="w-56" />
          </div>
          <div>
            <Label htmlFor="from" className="text-xs">
              From
            </Label>
            <Input id="from" type="date" name="from" defaultValue={params.from} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs">
              To
            </Label>
            <Input id="to" type="date" name="to" defaultValue={params.to} />
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {hasFilters && (
            <Link href="/admin/audit" className={buttonClasses("ghost", "md")}>
              Clear filters
            </Link>
          )}
        </form>

        {groups.length === 0 ? (
          <div className="px-4 py-12 text-center sm:px-5">
            <p className="text-sm font-medium text-fg">No entries found</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              {hasFilters ? "No audit entry matches the current filters." : "Nothing has been recorded yet."}
            </p>
            {hasFilters && (
              <Link href="/admin/audit" className={buttonClasses("secondary", "md", "mt-4")}>
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th className="whitespace-nowrap">When</Th>
                <Th>Action</Th>
                <Th className="hidden lg:table-cell">Actor</Th>
                <Th className="hidden md:table-cell">Entity</Th>
                <Th>Change</Th>
              </tr>
            </Thead>
            <tbody>
              {groups.flatMap((group) =>
                group.entries.map((entry, i) => (
                  <Tr key={entry.id} className="align-top">
                    <Td className="whitespace-nowrap text-xs text-fg-secondary">
                      {/* ISO, deliberately: an audit trail is read across
                          timezones and a localised date would be ambiguous
                          about which one it means. */}
                      {new Date(entry.occurredAt).toISOString().replace("T", " ").slice(0, 19)}
                      {i === 0 && group.entries.length > 1 && (
                        <span className="mt-1 block font-normal text-fg-muted">
                          {group.entries.length} entries in one action
                        </span>
                      )}
                    </Td>
                    <Td className={i > 0 ? "pl-6" : undefined}>
                      <span className="rounded bg-brand-subtle px-2 py-0.5 font-mono text-xs text-brand-fg">{entry.action}</span>
                    </Td>
                    <Td className="hidden text-xs text-fg-secondary lg:table-cell">
                      <span className="block font-mono break-all">{entry.actorUserId ?? "system"}</span>
                      <span className="text-fg-muted">{entry.actorRoleSnapshot ?? "—"}</span>
                    </Td>
                    <Td className="hidden text-xs text-fg-secondary md:table-cell">
                      <span className="block">{entry.entityType}</span>
                      {entry.entityId && <span className="block font-mono break-all text-fg-muted">{entry.entityId}</span>}
                      {entry.studentId && <span className="block font-mono break-all text-fg-muted">student {entry.studentId}</span>}
                    </Td>
                    <Td className="text-xs">
                      {entry.reason && <p className="mb-1 italic text-fg-secondary">Reason: {entry.reason}</p>}
                      {entry.oldValue === null && entry.newValue === null ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        /* The diff is behind a disclosure: a full before/after
                           JSON pair on every row would make the table
                           unscannable, which is the thing being fixed here. */
                        <details>
                          <summary className="cursor-pointer list-none font-medium text-brand-fg hover:underline">View change</summary>
                          <div className="mt-1 grid gap-1 sm:grid-cols-2">
                            <pre className="overflow-x-auto rounded bg-danger-surface p-1 text-danger-fg">
                              {entry.oldValue ? JSON.stringify(entry.oldValue, null, 1) : "—"}
                            </pre>
                            <pre className="overflow-x-auto rounded bg-success-surface p-1 text-success-fg">
                              {entry.newValue ? JSON.stringify(entry.newValue, null, 1) : "—"}
                            </pre>
                          </div>
                        </details>
                      )}
                    </Td>
                  </Tr>
                )),
              )}
            </tbody>
          </Table>
        )}
      </Card>

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-secondary">
            Showing {firstShown}&ndash;{firstShown + shown - 1} of {total} entr{total === 1 ? "y" : "ies"}
          </p>
          <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} label="Audit log pagination" />
        </div>
      )}
    </main>
  );
}
