import { boolean, integer, numeric, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./app";
import { student } from "./student";
import { semester } from "./calendar";

/**
 * Derived caches of the GPA engine's output (Section 9.4.15) -- genuine
 * stored tables, not views, written or rewritten in the same transaction
 * as any change to their inputs (publication, correction, historical
 * entry, import-status change). There is no background job (Section 7.4
 * confirms none exist in this system) -- recompute-on-write inside the
 * caller's own transaction is the only mechanism. May be deleted and
 * rebuilt from academic_record at any time without loss; that is the test
 * of whether it is really a cache.
 */

export const studentSemesterSummary = appSchema.table(
  "student_semester_summary",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "restrict" }),
    gpa: numeric("gpa", { precision: 7, scale: 6 }), // stored at 6dp (DEC-07); null when no eligible credits
    creditsAttempted: numeric("credits_attempted", { precision: 6, scale: 1 }).notNull(),
    creditsEarned: numeric("credits_earned", { precision: 6, scale: 1 }).notNull(),
    isProvisional: boolean("is_provisional").notNull(),
    policyVersion: integer("policy_version").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.studentId, table.semesterId] })],
);

export const studentCumulativeSummary = appSchema.table("student_cumulative_summary", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => student.id, { onDelete: "restrict" }),
  cgpa: numeric("cgpa", { precision: 7, scale: 6 }),
  totalCreditsAttempted: numeric("total_credits_attempted", { precision: 6, scale: 1 }).notNull(),
  totalCreditsEarned: numeric("total_credits_earned", { precision: 6, scale: 1 }).notNull(),
  isProvisional: boolean("is_provisional").notNull(),
  policyVersion: integer("policy_version").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
