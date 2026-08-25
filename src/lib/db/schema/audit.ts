import {
  pgSchema,
  bigserial,
  text,
  jsonb,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * The audit schema holds audit_log and nothing else, so that "no UPDATE, no
 * DELETE" is a schema-level statement that is trivial to verify (Section
 * 10.1). Privilege revocation (INSERT-only for the application role) is
 * applied in a hand-written SQL migration, not expressible in this schema
 * DSL — see drizzle/0001_audit_privileges.sql once generated.
 */
export const auditSchema = pgSchema("audit");

export const auditLog = auditSchema.table(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorUserId: uuid("actor_user_id"), // FK to app_user added in Stage 2
    actorRoleSnapshot: text("actor_role_snapshot"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    studentId: uuid("student_id"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reason: text("reason"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("audit_log_student_occurred_idx").on(
      table.studentId,
      table.occurredAt,
    ),
    index("audit_log_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
    index("audit_log_occurred_idx").on(table.occurredAt),
  ],
);
