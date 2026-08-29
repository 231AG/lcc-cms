import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { auditWrite } from "./audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";

export interface AuditLogFilters {
  studentId?: string;
  action?: string;
  entityType?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
}

export interface AuditLogGroup {
  requestId: string | null;
  entries: Array<typeof auditLog.$inferSelect>;
}

const PAGE_SIZE = 50;

/**
 * X-06 (plan Section 20.5, REQ-R08): "Filterable log with grouped
 * correlated entries and readable diffs ... viewing is itself logged."
 * Reads through the superuser connection deliberately -- `authenticated`
 * has INSERT-only privilege on audit.audit_log (DER-20, see
 * 0001_audit_privileges.sql), so RLS has nothing to grant here even to a
 * Super Admin; `audit.view` in the permission kernel is the only gate.
 */
export async function getAuditLogPage(
  actor: Actor,
  filters: AuditLogFilters,
  page: number,
): Promise<{ groups: AuditLogGroup[]; hasMore: boolean; page: number }> {
  await assertCan(actor, "audit.view");

  const conditions: SQL[] = [];
  if (filters.studentId) conditions.push(eq(auditLog.studentId, filters.studentId));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.occurredFrom) conditions.push(gte(auditLog.occurredAt, filters.occurredFrom));
  if (filters.occurredTo) conditions.push(lte(auditLog.occurredAt, filters.occurredTo));

  const safePage = Math.max(0, page);
  const offset = safePage * PAGE_SIZE;
  const rows = await db.query.auditLog.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (t, { desc }) => desc(t.occurredAt),
    limit: PAGE_SIZE + 1,
    offset,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  // Rows already come back ordered by time descending, so entries written
  // by one transaction (sharing a request_id) are adjacent -- grouping
  // consecutive rows is enough to turn a 60-row batch approval into one
  // group instead of 60 unrelated lines (Section 20.5's "grouped
  // correlated entries").
  const groups: AuditLogGroup[] = [];
  for (const row of pageRows) {
    const last = groups[groups.length - 1];
    if (row.requestId && last?.requestId === row.requestId) {
      last.entries.push(row);
    } else {
      groups.push({ requestId: row.requestId, entries: [row] });
    }
  }

  // "The act of reading it is itself logged" (Section 11.3) -- filters
  // and page are recorded, not the results, matching the audit entry's
  // own "only the fields that changed" spirit rather than a full dump.
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "AUDIT_LOG_VIEWED",
      entityType: "audit_log",
      newValue: { filters, page: safePage },
    }),
  );

  return { groups, hasMore, page: safePage };
}
