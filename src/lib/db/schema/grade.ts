import { text, integer, numeric, uuid, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema } from "./app";
import { appUser } from "./identity";
import { courseOffering } from "./offering";
import { registration } from "./planning";

/**
 * The reviewable unit a Super Admin approves or rejects: one class's
 * grades, submitted together (Section 9.4.11, REQ-G06, DER-18). Decisions
 * live on each grade_record, not here, because a Super Admin may act per
 * grade or on the whole batch (CR-06) -- this row just tracks the batch's
 * own progress through review.
 */
export const gradeSubmission = appSchema.table(
  "grade_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => courseOffering.id, { onDelete: "restrict" }),
    attemptNo: integer("attempt_no").notNull().default(1),
    status: text("status").notNull().default("SUBMITTED"), // SUBMITTED | PARTIALLY_DECIDED | CLOSED
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    gradeCount: integer("grade_count").notNull(),
    undecidedCount: integer("undecided_count").notNull(),
    // Section 9.4.11 Constraints: "reviewed_by != submitted_by -- a check
    // constraint, so the two-key rule survives even a defect in the
    // service layer." Set on the first decision (individual or batch) and
    // never overwritten afterward, even if a later decision on the same
    // submission is made by a different Super Admin -- it records who
    // first reviewed it, not a running "last touched by".
    reviewedBy: uuid("reviewed_by").references(() => appUser.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    check("grade_submission_status_valid", sql`${table.status} IN ('SUBMITTED', 'PARTIALLY_DECIDED', 'CLOSED')`),
    check("grade_submission_segregation_of_duties", sql`${table.reviewedBy} IS NULL OR ${table.reviewedBy} != ${table.submittedBy}`),
  ],
);

/**
 * One student's result for one registration, moving through
 * entry -> approval -> publication -> lock (Section 9.4.12). Invisible to
 * the student at every stage before PUBLISHED (Section 15.1's "the
 * control this whole workflow exists to provide").
 */
export const gradeRecord = appSchema.table(
  "grade_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "restrict" }),
    submissionId: uuid("submission_id").references(() => gradeSubmission.id, { onDelete: "restrict" }), // nullable while DRAFT
    score: numeric("score", { precision: 4, scale: 1 }), // nullable -- Incomplete has no score
    letter: text("letter").notNull(),
    gradePoint: numeric("grade_point", { precision: 3, scale: 2 }), // nullable -- Incomplete
    status: text("status").notNull().default("DRAFT"), // DRAFT | SUBMITTED | PUBLISHED | LOCKED
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    // Section 9.4.12 Constraints: "decided_by != entered_by as a check
    // constraint, in addition to the submission-level constraint" --
    // segregation of duties enforced per grade, not only per batch.
    decidedBy: uuid("decided_by").references(() => appUser.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"), // set on rejection; null on approval
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    check("grade_record_status_valid", sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'LOCKED')`),
    check("grade_record_score_range", sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`),
    check("grade_record_segregation_of_duties", sql`${table.decidedBy} IS NULL OR ${table.decidedBy} != ${table.enteredBy}`),
  ],
);

/**
 * The only lawful route to changing a locked grade (Section 9.4.13,
 * REQ-G08). Modelled as a request so the change is proposed by one actor
 * and effected by another -- unlike Stage 6's historical-record
 * correction (DEV-05's direct Admin-only path), this two-key model is
 * REQ-G08's hard requirement, not a recommendation, because a locked
 * grade has already been published and may already be part of a
 * student's relied-upon record.
 */
export const gradeCorrectionRequest = appSchema.table(
  "grade_correction_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gradeRecordId: uuid("grade_record_id")
      .notNull()
      .references(() => gradeRecord.id, { onDelete: "restrict" }),
    // Captured at request time; re-verified against the live grade at
    // decision time so a request can be rejected as stale rather than
    // applied blindly if the grade changed in between (Section 15.5).
    oldScore: numeric("old_score", { precision: 4, scale: 1 }),
    oldLetter: text("old_letter").notNull(),
    oldGradePoint: numeric("old_grade_point", { precision: 3, scale: 2 }),
    newScore: numeric("new_score", { precision: 4, scale: 1 }),
    newLetter: text("new_letter").notNull(),
    newGradePoint: numeric("new_grade_point", { precision: 3, scale: 2 }),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    decidedBy: uuid("decided_by").references(() => appUser.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (table) => [
    check("grade_correction_status_valid", sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
    check("grade_correction_segregation_of_duties", sql`${table.decidedBy} IS NULL OR ${table.decidedBy} != ${table.requestedBy}`),
  ],
);
