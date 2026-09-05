import { text, integer, timestamp, uuid, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";
import { appUser } from "./identity";
import { department } from "./structure";

/**
 * The academic profile of a person enrolled at the College (Section 9.4.2).
 * 1:1 with `app_user` -- `id` matches the app_user row created alongside it
 * at enrolment, the same "no separate identity table" pattern as
 * `app_user` itself. Minimal attribute set per DEC-21: name parts, Student
 * ID, department, enrolment year, status, one contact field -- nothing
 * collected without a named use.
 */
export const student = appSchema.table(
  "student",
  {
    // Shares its primary key with app_user (the same "no separate identity
    // table" pattern app_user itself uses for the Supabase Auth id) --
    // there is no redundant app_user_id column, just one id meaning the
    // same person in both tables.
    id: uuid("id").primaryKey().references(() => appUser.id, { onDelete: "restrict" }),
    // Unique on trim(student_number) via the index 0009 creates -- the rule
    // an Admin's ID edit is checked against, not just enrolment's.
    studentNumber: text("student_number").notNull(), // DEC-02 / CR-08 format, validated in the service layer
    firstName: text("first_name").notNull(),
    // Optional -- NULL means "none recorded". The service layer coerces an
    // empty string to NULL so there is one representation, not two.
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    // MALE | FEMALE. Required by the enrolment form from 0025 onward, but
    // nullable in the column: students enrolled before it existed have no
    // recorded gender, and NULL says that honestly where a default would
    // have asserted something false about them.
    gender: text("gender"),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "restrict" }),
    enrolmentYear: integer("enrolment_year").notNull(),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | INACTIVE | SUSPENDED | GRADUATED | ADMISSION_FORFEITED
    // Optional secondary field of study. Free text, not a department
    // reference -- a minor is not always something the College awards
    // degrees in. Same ""-becomes-NULL discipline as middleName.
    minor: text("minor"),
    contactPhone: text("contact_phone"),
    historicalImportStatus: text("historical_import_status").notNull().default("NOT_STARTED"), // NOT_STARTED | IN_PROGRESS | COMPLETE
    importCompletedBy: uuid("import_completed_by"),
    importCompletedAt: timestamp("import_completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("student_department_idx").on(table.departmentId),
    index("student_status_idx").on(table.status),
    check("student_gender_valid", sql`${table.gender} IS NULL OR ${table.gender} IN ('MALE', 'FEMALE')`),
    check(
      "student_status_valid",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'GRADUATED', 'ADMISSION_FORFEITED')`,
    ),
    check(
      "student_import_status_valid",
      sql`${table.historicalImportStatus} IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE')`,
    ),
  ],
);
