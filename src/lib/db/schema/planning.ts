import { text, integer, boolean, uuid, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";
import { student } from "./student";
import { semester } from "./calendar";
import { course } from "./structure";
import { courseOffering } from "./offering";
import { appUser } from "./identity";

/**
 * A student's proposed set of courses for one semester, and the Admin's
 * decision on it (Section 9.4.9, REQ-P01/REQ-P10). One mutable row per
 * (student, semester) -- "at most one non-superseded plan" is honoured by
 * having exactly one row that transitions in place rather than by
 * versioning separate rows; `version` is an incrementing resubmission
 * counter for display/audit correlation, not a row-selector.
 *
 * State machine (Section 14.2): DRAFT -> SUBMITTED -> APPROVED (terminal)
 * or -> REJECTED -> back to DRAFT for revision. Two readings of "editable
 * until approved" were possible; the plan deliberately picked "editable
 * until submitted, then again if rejected" over "editable right up to
 * approval" (DEC-35) -- the latter would let a student alter a plan an
 * Admin is actively reviewing.
 *
 * PARTIALLY_APPROVED (DEV-19, per-course review): once every item on a
 * SUBMITTED plan has an individual decision, the plan auto-resolves to
 * APPROVED (all items approved), REJECTED (all items rejected), or this
 * new terminal state for a mixed outcome. Like APPROVED, it is not
 * revisable -- registrations already exist for the approved items.
 */
export const coursePlan = appSchema.table(
  "course_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("DRAFT"), // DRAFT | SUBMITTED | APPROVED | REJECTED | PARTIALLY_APPROVED
    totalCredits: integer("total_credits").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => appUser.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    check("course_plan_status_valid", sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED')`),
    // REQ-P10: a rejection must carry a reason, enforced by the database,
    // not only by the form.
    check(
      "course_plan_rejection_reason_required",
      sql`${table.status} != 'REJECTED' OR ${table.rejectionReason} IS NOT NULL`,
    ),
  ],
);

/**
 * One selected offering within a plan (Section 9.4.9). Carries both
 * `offering_id` (what's actually being planned) and `course_id`
 * (redundant with offering.courseId, but named explicitly in the spec so
 * validators can compare against academic_record/prerequisites without an
 * offering join on every check).
 *
 * `status` (DEV-19): each planned course gets its own Admin decision --
 * "one bad planned course shouldn't force rejecting the entire plan."
 * PENDING is the state under SUBMITTED review; APPROVED creates a
 * registration for that item alone; REJECTED requires a reason, same
 * convention as the plan-level rejection. See coursePlan's own doc
 * comment for how these roll up into the plan's overall status.
 */
export const coursePlanItem = appSchema.table(
  "course_plan_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => coursePlan.id, { onDelete: "restrict" }),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => courseOffering.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    isRetake: boolean("is_retake").notNull().default(false),
    // Set only by Admin's overridePrerequisite action (REQ-P11), one item
    // at a time -- "no 'approve anyway' button for a whole plan" (Section
    // 14.5).
    prereqOverrideReason: text("prereq_override_reason"),
    prereqOverrideBy: uuid("prereq_override_by").references(() => appUser.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    rejectionReason: text("rejection_reason"),
    decidedBy: uuid("decided_by").references(() => appUser.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    check("course_plan_item_status_valid", sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
    check("course_plan_item_rejection_reason_required", sql`${table.status} != 'REJECTED' OR ${table.rejectionReason} IS NOT NULL`),
  ],
);

/**
 * The fact that a student is enrolled in a specific offering for a
 * specific semester (Section 9.4.10) -- the anchor a grade attaches to
 * and the source of the class list. Created by the system atomically on
 * plan approval, or directly by an Admin (DEC-14). Never by a student,
 * never by a Super Admin.
 */
export const registration = appSchema.table(
  "registration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "restrict" }),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => courseOffering.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id, { onDelete: "restrict" }),
    planItemId: uuid("plan_item_id").references(() => coursePlanItem.id, { onDelete: "restrict" }),
    source: text("source").notNull(), // PLAN_APPROVAL | ADMIN_DIRECT
    isRetake: boolean("is_retake").notNull().default(false),
    status: text("status").notNull().default("REGISTERED"), // REGISTERED | DROPPED
    droppedReason: text("dropped_reason"),
    // Copied from course_offering.frozenCreditHours at registration time --
    // same DER-07 "credit hours are the one deliberate exception" pattern
    // Stage 8 established for the offering itself.
    frozenCreditHours: integer("frozen_credit_hours").notNull(),
  },
  (table) => [
    check("registration_source_valid", sql`${table.source} IN ('PLAN_APPROVAL', 'ADMIN_DIRECT')`),
    check("registration_status_valid", sql`${table.status} IN ('REGISTERED', 'DROPPED')`),
    check("registration_dropped_reason_required", sql`${table.status} != 'DROPPED' OR ${table.droppedReason} IS NOT NULL`),
  ],
);
