import {
  pgSchema,
  text,
  integer,
  numeric,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * All Phase 1 business tables live in the `app` schema, mediated by RLS
 * policies added from Stage 2 onward. See plan Section 10.1.
 */
export const appSchema = pgSchema("app");

/**
 * Named institution configuration (credit limits, GPA rounding, prerequisite
 * override window, current academic year, etc). Every value that is
 * currently an open decision in the plan lives here, so answering it later
 * is a config change, not a code change (Section 9.4.17).
 */
export const institutionSetting = appSchema.table("institution_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by"), // FK to app_user added in Stage 2
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The College's grading policy as data (Section 16.2, CR-01/CR-02).
 * Versioned: changing the scale creates a new policy_version rather than
 * editing rows in place, so historical figures stay reproducible.
 */
export const gradeScale = appSchema.table(
  "grade_scale",
  {
    policyVersion: integer("policy_version").notNull(),
    letter: text("letter").notNull(),
    minScore: integer("min_score"),
    maxScore: integer("max_score"),
    gradePoint: numeric("grade_point", { precision: 3, scale: 2 }),
    countsInGpa: boolean("counts_in_gpa").notNull(),
    countsInAttempted: boolean("counts_in_attempted").notNull(),
    countsInEarned: boolean("counts_in_earned").notNull(),
    isPassing: boolean("is_passing").notNull(),
    displayOrder: integer("display_order").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.policyVersion, table.letter] })],
);

/**
 * Implements DER-13: every mutating request carries a client-generated
 * idempotency key; a repeated key returns the original result rather than
 * performing the action twice. Keys are purged after a short retention
 * window (see Stage 1 cleanup job, added when a scheduler exists).
 */
export const idempotencyKey = appSchema.table("idempotency_key", {
  key: text("key").primaryKey(),
  actorUserId: uuid("actor_user_id"), // FK to app_user added in Stage 2
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
