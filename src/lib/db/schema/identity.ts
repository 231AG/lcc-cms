import { text, boolean, timestamp, uuid, index, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./app";

/**
 * The single authentication and authorisation anchor for every person who
 * can log in (Section 9.4.1). `id` matches the Supabase Auth user id
 * one-to-one -- there is no separate identity table.
 *
 * Role is immutable after creation (enforced again by a trigger in
 * 0002_identity.sql, not only here): changing what someone may do means
 * disabling one account and creating another, so audit attribution stays
 * truthful (Section 11.4).
 */
export const appUser = appSchema.table(
  "app_user",
  {
    id: uuid("id").primaryKey(),
    loginIdentifier: text("login_identifier").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(), // STUDENT | ADMIN | SUPER_ADMIN — see CHECK constraint
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | DISABLED
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("app_user_login_identifier_idx").on(table.loginIdentifier)],
);

/**
 * The permission matrix as data (Section 11), grown one row at a time as
 * each stage's real actions are built -- never seeded speculatively ahead
 * of the feature that needs it (Section 11.4: "Adding an action to the
 * system means adding a row; an action with no row is denied by default").
 */
export const permission = appSchema.table(
  "permission",
  {
    role: text("role").notNull(), // STUDENT | ADMIN | SUPER_ADMIN
    action: text("action").notNull(),
    allowed: boolean("allowed").notNull(),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.role, table.action] })],
);
