import { text, integer, uuid, time, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";
import { semester } from "./calendar";
import { course } from "./structure";

/**
 * A course actually taught in a specific semester, as a specific section
 * (Section 9.4.7). Distinct from `course` (the catalogue entry, true
 * regardless of when it's taught) and from a future registration (which
 * student took this specific offering) -- "Course, Offering and
 * Registration are three different things" (Section 12.3).
 */
export const courseOffering = appSchema.table(
  "course_offering",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    section: text("section").notNull(), // e.g. "A" -- unique only within (semester, course), Section 12.4
    instructorName: text("instructor_name"), // free text, no account (ASM-10/DER-15, OOS-01)
    capacity: integer("capacity"), // nullable -- GAP-26, enforced only when set
    status: text("status").notNull().default("DRAFT"), // DRAFT | PUBLISHED | CANCELLED
    // Copied from course.creditHours at creation and never edited again, so
    // a later catalogue change never rewrites what was actually taught
    // (DER-07, Section 12.3's "credit hours are the one deliberate exception").
    frozenCreditHours: integer("frozen_credit_hours").notNull(),
  },
  (table) => [
    check("course_offering_status_valid", sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'CANCELLED')`),
    check("course_offering_capacity_positive", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
  ],
);

/**
 * A structured meeting time for an offering (Section 9.4.8) -- structured
 * rather than free text specifically so Stage 9's per-student schedule-
 * conflict check (V6) can be performed against it (DER-14).
 */
export const offeringMeeting = appSchema.table(
  "offering_meeting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => courseOffering.id, { onDelete: "restrict" }),
    dayOfWeek: integer("day_of_week").notNull(), // 1 (Monday) - 7 (Sunday)
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    room: text("room"),
  },
  (table) => [
    check("offering_meeting_day_valid", sql`${table.dayOfWeek} BETWEEN 1 AND 7`),
    check("offering_meeting_end_after_start", sql`${table.endTime} > ${table.startTime}`),
  ],
);

