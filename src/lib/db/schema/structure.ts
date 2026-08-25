import {
  text,
  integer,
  numeric,
  boolean,
  uuid,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";

/**
 * The College's organisational hierarchy (Section 9.4.3/9.4.4) and course
 * catalogue. Durable reference data -- survives across semesters, never
 * hard-deleted once anything references it (DER-22).
 */

export const college = appSchema.table("college", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const department = appSchema.table("department", {
  id: uuid("id").primaryKey().defaultRandom(),
  collegeId: uuid("college_id")
    .notNull()
    .references(() => college.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // A department may set a ceiling BELOW the institution default (21),
  // never above it -- enforced in the service layer, not here, since the
  // institution default is dynamic config (CR-04).
  maxCreditsOverride: integer("max_credits_override"),
});

export const course = appSchema.table(
  "course",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    creditHours: integer("credit_hours").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Nullable: defaults to the institution passing grade (0.70) when unset
    // (Section 9.4.5).
    prerequisiteMinGrade: numeric("prerequisite_min_grade", { precision: 3, scale: 2 }),
  },
  (table) => [check("course_credit_hours_positive", sql`${table.creditHours} > 0`)],
);

export const coursePrerequisite = appSchema.table(
  "course_prerequisite",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    prerequisiteCourseId: uuid("prerequisite_course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    // Nullable: defaults to the institution passing grade when unset.
    minGrade: numeric("min_grade", { precision: 3, scale: 2 }),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.prerequisiteCourseId] }),
    check("course_prerequisite_no_self_reference", sql`${table.courseId} != ${table.prerequisiteCourseId}`),
  ],
);
