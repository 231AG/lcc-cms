import { text, integer, numeric, boolean, uuid, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";
import { appUser } from "./identity";
import { student } from "./student";
import { semester } from "./calendar";
import { course } from "./structure";

/**
 * The single source of academic truth (Section 9.4.14). One row per
 * completed course result, whatever its origin -- every GPA, CGPA,
 * prerequisite decision and future transcript reads this table and
 * nothing else. Stage 6 only ever writes origin = 'IMPORTED' rows;
 * origin = 'SYSTEM' rows (grade publication) and the grade_record FK
 * they point to are Stage 10's work -- the columns exist now so this
 * table doesn't need a structural migration later, but grade_record_id
 * has no FK reference yet because that table doesn't exist yet.
 */
export const academicRecord = appSchema.table(
  "academic_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "restrict" }),
    // Nullable: a course code that doesn't match the catalogue is accepted
    // with a flag (Section 17.5 validation #4, "retired courses legitimately
    // appear on old records") -- uniqueness and display then key off the
    // frozen snapshot text, not this FK.
    courseId: uuid("course_id").references(() => course.id, { onDelete: "restrict" }),
    courseCodeSnapshot: text("course_code_snapshot").notNull(),
    courseTitleSnapshot: text("course_title_snapshot").notNull(),
    creditHours: numeric("credit_hours", { precision: 4, scale: 1 }).notNull(),
    letter: text("letter").notNull(),
    // Nullable: the Incomplete grade has no grade point (Section 16.2).
    gradePoint: numeric("grade_point", { precision: 3, scale: 2 }),
    score: integer("score"),
    attemptNo: integer("attempt_no").notNull().default(1),
    origin: text("origin").notNull().default("IMPORTED"), // SYSTEM | IMPORTED
    gradeRecordId: uuid("grade_record_id"),
    countsInGpa: boolean("counts_in_gpa").notNull(),
    countsInAttempted: boolean("counts_in_attempted").notNull(),
    countsInEarned: boolean("counts_in_earned").notNull(),
    isRepeatDropped: boolean("is_repeat_dropped").notNull().default(false),
    wasMajorAtRecord: boolean("was_major_at_record").notNull().default(false),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    sourceNote: text("source_note"),
    isVoid: boolean("is_void").notNull().default(false),
    voidedBy: uuid("voided_by").references(() => appUser.id, { onDelete: "restrict" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (table) => [
    check("academic_record_credit_hours_positive", sql`${table.creditHours} > 0`),
    check(
      "academic_record_grade_point_range",
      sql`${table.gradePoint} IS NULL OR (${table.gradePoint} BETWEEN 0.0 AND 4.0)`,
    ),
    check("academic_record_origin_valid", sql`${table.origin} IN ('SYSTEM', 'IMPORTED')`),
    // A change to the two-column pair below cannot be confused (Section
    // 9.4.14): a SYSTEM row must point at the grade_record that produced
    // it; an IMPORTED row never has one.
    check(
      "academic_record_origin_grade_record_coherence",
      sql`(${table.origin} = 'IMPORTED' AND ${table.gradeRecordId} IS NULL) OR (${table.origin} = 'SYSTEM' AND ${table.gradeRecordId} IS NOT NULL)`,
    ),
  ],
);
