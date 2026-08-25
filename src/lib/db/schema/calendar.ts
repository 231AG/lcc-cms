import { text, integer, date, boolean, uuid, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";

/**
 * The time skeleton of the academic record (Section 9.4.6). Every result,
 * plan, offering and registration will eventually hang off a semester.
 */

export const academicYear = appSchema.table("academic_year", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(), // e.g. "2026/2027" -- CR-10
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
});

/**
 * `state` is constrained to the six values of REQ-W01 by a CHECK
 * constraint (Section 10.3: enums as CHECK, not native Postgres enums, so
 * the set can be edited without a schema-lock operation).
 */
export const semester = appSchema.table(
  "semester",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYear.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(), // 1 or 2 -- CR-10, exactly two semesters per year
    name: text("name").notNull(), // "First Semester", "Second Semester"
    state: text("state").notNull().default("DRAFT"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (table) => [
    check(
      "semester_state_valid",
      sql`${table.state} IN ('DRAFT', 'OPEN', 'REGISTRATION', 'IN_PROGRESS', 'GRADE_SUBMISSION', 'CLOSED')`,
    ),
  ],
);
