import type { Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import type { AuditAction } from "./actions";

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  studentId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes one audit entry. MUST be called with the same `tx` handle as the
 * change it describes (DER-21) — never after commit, never on a bare `db`.
 *
 * Deliberately does not use `.returning()`: the `authenticated` Postgres
 * role is granted INSERT but not SELECT on audit.audit_log (DER-20), and
 * RETURNING requires both. Callers that need to correlate entries use the
 * caller-supplied `requestId`, not the generated row id.
 */
export async function auditWrite(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    actorRoleSnapshot: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    studentId: entry.studentId ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason ?? null,
    requestId: entry.requestId ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
