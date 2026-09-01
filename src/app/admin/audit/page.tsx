import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { getAuditLogPage } from "@/lib/audit/query";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";

export const metadata: Metadata = { title: "Audit log" };

/**
 * X-06 (plan Section 20.5, REQ-R08) -- Super Admin only. Filters are plain
 * GET query params so a filtered view has a shareable/bookmarkable URL,
 * consistent with "Empty for a filter that matches nothing, with the
 * filter restated."
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
  const page = params.page ? Number(params.page) : 0;

  const { groups, hasMore } = await getAuditLogPage(actor, filters, Number.isFinite(page) ? page : 0);
  const hasFilters = Boolean(filters.studentId || filters.action || filters.entityType || filters.occurredFrom || filters.occurredTo);

  const qs = (overrides: Record<string, string | number | undefined>) => {
    const merged = { ...params, ...overrides };
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") search.set(k, String(v));
    }
    return `?${search.toString()}`;
  };

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Audit log" description="Viewing this page is itself recorded in the log." />

      <Card className="mb-6 p-3">
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
          <div className="flex flex-col gap-1">
            <Label htmlFor="studentId" className="text-xs">
              Student ID (internal)
            </Label>
            <Input id="studentId" name="studentId" defaultValue={params.studentId} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="action" className="text-xs">
              Action
            </Label>
            <Select id="action" name="action" defaultValue={params.action ?? ""}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="entityType" className="text-xs">
              Entity type
            </Label>
            <Input id="entityType" name="entityType" defaultValue={params.entityType} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="from" className="text-xs">
              From
            </Label>
            <Input id="from" type="date" name="from" defaultValue={params.from} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to" className="text-xs">
              To
            </Label>
            <Input id="to" type="date" name="to" defaultValue={params.to} />
          </div>
          <Button type="submit" size="sm">
            Filter
          </Button>
          {hasFilters && (
            <a href="/admin/audit" className="text-sm font-medium text-brand-700 hover:underline">
              Clear
            </a>
          )}
        </form>
      </Card>

      {groups.length === 0 && (
        <p className="text-sm text-neutral-500">{hasFilters ? "No entries match this filter." : "No audit entries yet."}</p>
      )}

      <ul className="flex flex-col gap-3">
        {groups.map((group, i) => (
          <li key={group.requestId ?? `single-${i}`}>
            <Card className="p-3 text-sm">
              {group.entries.length > 1 && (
                <p className="mb-2 text-xs font-medium text-neutral-500">
                  {group.entries.length} correlated entries (request {group.requestId})
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <li key={entry.id} className="border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-700">{entry.action}</span>
                      <span className="text-xs text-neutral-500">{new Date(entry.occurredAt).toISOString()}</span>
                      <span className="text-xs text-neutral-500">
                        actor: {entry.actorUserId ?? "system"} ({entry.actorRoleSnapshot ?? "—"})
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-600">
                      {entry.entityType}
                      {entry.entityId ? ` #${entry.entityId}` : ""}
                      {entry.studentId ? ` · student ${entry.studentId}` : ""}
                    </p>
                    {entry.reason && <p className="mt-1 text-xs italic text-neutral-700">Reason: {entry.reason}</p>}
                    {(entry.oldValue !== null || entry.newValue !== null) && (
                      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                        <pre className="overflow-x-auto rounded bg-danger-50 p-1 text-danger-800">{entry.oldValue ? JSON.stringify(entry.oldValue) : "—"}</pre>
                        <pre className="overflow-x-auto rounded bg-success-50 p-1 text-success-800">{entry.newValue ? JSON.stringify(entry.newValue) : "—"}</pre>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between text-sm">
        {page > 0 ? (
          <a href={qs({ page: page - 1 })} className="font-medium text-brand-700 hover:underline">
            Newer
          </a>
        ) : (
          <span />
        )}
        {hasMore && (
          <a href={qs({ page: page + 1 })} className="font-medium text-brand-700 hover:underline">
            Older
          </a>
        )}
      </div>
    </main>
  );
}
