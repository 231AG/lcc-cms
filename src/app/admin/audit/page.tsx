import { getCurrentActor } from "@/lib/auth/session";
import { getAuditLogPage } from "@/lib/audit/query";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

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

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
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
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold">Audit log</h1>
      <p className="mb-6 text-xs text-gray-500">Viewing this page is itself recorded in the log.</p>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded border border-gray-200 p-3 text-sm" method="get">
        <div className="flex flex-col gap-1">
          <label htmlFor="studentId" className="text-xs text-gray-600">Student ID (internal)</label>
          <input id="studentId" name="studentId" defaultValue={params.studentId} className="rounded border border-gray-300 px-2 py-1" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-xs text-gray-600">Action</label>
          <select id="action" name="action" defaultValue={params.action ?? ""} className="rounded border border-gray-300 px-2 py-1">
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="entityType" className="text-xs text-gray-600">Entity type</label>
          <input id="entityType" name="entityType" defaultValue={params.entityType} className="rounded border border-gray-300 px-2 py-1" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs text-gray-600">From</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="rounded border border-gray-300 px-2 py-1" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs text-gray-600">To</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="rounded border border-gray-300 px-2 py-1" />
        </div>
        <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">Filter</button>
        {hasFilters && (
          <a href="/admin/audit" className="text-blue-700 underline">Clear</a>
        )}
      </form>

      {groups.length === 0 && (
        <p className="text-sm text-gray-500">
          {hasFilters ? "No entries match this filter." : "No audit entries yet."}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {groups.map((group, i) => (
          <li key={group.requestId ?? `single-${i}`} className="rounded border border-gray-200 p-3 text-sm">
            {group.entries.length > 1 && (
              <p className="mb-2 text-xs font-medium text-gray-500">
                {group.entries.length} correlated entries (request {group.requestId})
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {group.entries.map((entry) => (
                <li key={entry.id} className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">{entry.action}</span>
                    <span className="text-xs text-gray-500">{new Date(entry.occurredAt).toISOString()}</span>
                    <span className="text-xs text-gray-500">
                      actor: {entry.actorUserId ?? "system"} ({entry.actorRoleSnapshot ?? "—"})
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">
                    {entry.entityType}
                    {entry.entityId ? ` #${entry.entityId}` : ""}
                    {entry.studentId ? ` · student ${entry.studentId}` : ""}
                  </p>
                  {entry.reason && <p className="mt-1 text-xs italic text-gray-700">Reason: {entry.reason}</p>}
                  {(entry.oldValue !== null || entry.newValue !== null) && (
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                      <pre className="overflow-x-auto rounded bg-red-50 p-1 text-red-900">{entry.oldValue ? JSON.stringify(entry.oldValue) : "—"}</pre>
                      <pre className="overflow-x-auto rounded bg-green-50 p-1 text-green-900">{entry.newValue ? JSON.stringify(entry.newValue) : "—"}</pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between text-sm">
        {page > 0 ? (
          <a href={qs({ page: page - 1 })} className="text-blue-700 underline">Newer</a>
        ) : (
          <span />
        )}
        {hasMore && (
          <a href={qs({ page: page + 1 })} className="text-blue-700 underline">Older</a>
        )}
      </div>
    </main>
  );
}
