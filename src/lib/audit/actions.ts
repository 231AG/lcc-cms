/**
 * The typed audit action vocabulary (plan Section 19.3). A new action must
 * be registered here before any code can log it — this is what forces the
 * question "should this be audited?" at the moment the action is written,
 * rather than leaving audit coverage to convention.
 */
export const AUDIT_ACTIONS = [
  // Grades
  "GRADE_ENTERED",
  "GRADE_DRAFT_EDITED",
  "GRADE_DRAFT_CLEARED",
  "GRADE_SUBMISSION_CREATED",
  "GRADE_SUBMISSION_APPROVED",
  "GRADE_SUBMISSION_REJECTED",
  "GRADE_PUBLISHED",
  "GRADE_CORRECTION_REQUESTED",
  "GRADE_CORRECTION_APPROVED",
  "GRADE_CORRECTION_REJECTED",

  // Calendar (Stage 4)
  "ACADEMIC_YEAR_CREATED",
  "SEMESTER_CREATED",
  "SEMESTER_DELETED",

  // Institution configuration
  "INSTITUTION_SETTING_UPDATED",

  // Course offerings and scheduling (Stage 8) -- not pre-named in the
  // plan's own Section 19.3 vocabulary table (only what must be audited
  // is specified, not the exact action names), so these follow the
  // existing naming convention.
  "OFFERING_CREATED",
  "OFFERING_PUBLISHED",
  "OFFERING_CANCELLED",
  "OFFERING_REINSTATED",
  "OFFERING_UPDATED",
  "OFFERING_MEETING_CHANGED",

  // Academic structure (Stage 3)
  "COLLEGE_CREATED",
  "COLLEGE_UPDATED",
  "COLLEGE_DEACTIVATED",
  "COLLEGE_REACTIVATED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "DEPARTMENT_DEACTIVATED",
  "DEPARTMENT_REACTIVATED",
  "COURSE_CREATED",
  // One entry for a whole pasted catalogue, not one per course: the event
  // is "the catalogue was loaded", and 800 rows would bury the log.
  "COURSE_IMPORTED",
  "COURSE_UPDATED",
  "COURSE_DEACTIVATED",
  "COURSE_REACTIVATED",

  // Academic records and historical import
  "HISTORICAL_RECORD_ENTERED",
  "HISTORICAL_RECORD_CORRECTED",
  "IMPORT_STATUS_CHANGED",
  "ACADEMIC_RECORD_VOIDED",

  // Semester and planning
  "SEMESTER_STATE_CHANGED",
  "COURSE_PLAN_SUBMITTED",
  // DEV-20: an Admin opened a plan on a student's behalf. Submission
  // itself stays COURSE_PLAN_SUBMITTED regardless of who did it (with
  // `enteredOnBehalf` in the payload), so existing queries keep working.
  "COURSE_PLAN_STARTED_FOR_STUDENT",
  "COURSE_PLAN_APPROVED",
  "COURSE_PLAN_REJECTED",
  "COURSE_PLAN_PARTIALLY_APPROVED",
  "COURSE_PLAN_REVISED",
  // A student pulling their own submitted plan back out of the review queue
  // so they can change it. Recorded because it removes work an Admin may
  // already have open in front of them.
  "COURSE_PLAN_WITHDRAWN",
  // The same departure from the queue, but as a side effect of the student
  // editing rather than an explicit withdrawal. Its own name so the two are
  // distinguishable in the log: one is "I changed my mind about submitting",
  // the other is "I changed the plan". An Admin whose queue item vanished
  // needs to be able to tell which.
  "COURSE_PLAN_REOPENED",
  // A reviewer taking back their own decision on a whole plan, because it
  // was made in error. Distinct from REVISED (the student reworking a plan
  // that was refused) and from REOPENED (an edit pulling a plan out of the
  // queue): this one is the reviewer correcting themselves, and it is the
  // only action that puts an already-decided plan back under review.
  "COURSE_PLAN_DECISION_UNDONE",
  "COURSE_PLAN_ITEM_APPROVED",
  "COURSE_PLAN_ITEM_REJECTED",
  // One course put back to Pending because the decision on it was wrong.
  // Separate from the whole-plan undo: an Admin deciding row by row sits
  // at SUBMITTED the whole time, so this is the correction that actually
  // gets used, and it should be findable on its own in the log.
  "COURSE_PLAN_ITEM_DECISION_UNDONE",
  "PREREQUISITE_OVERRIDDEN",
  // An Admin accepting that two planned courses overlap, so the plan can be
  // approved despite the clash.
  "SCHEDULE_CONFLICT_OVERRIDDEN",
  "REGISTRATION_CREATED",
  // A seat coming BACK after it was dropped. Its own action rather than a
  // second REGISTRATION_CREATED, because app.registration carries a unique
  // (student_id, offering_id) that covers dropped rows -- so re-approving
  // updates the existing row in place, and an auditor reading the log
  // should not have to infer from a timestamp whether a seat was created
  // or returned.
  "REGISTRATION_REINSTATED",
  "REGISTRATION_DROPPED",

  // Administration and configuration
  "USER_CREATED",
  "USER_DISABLED",
  "USER_ENABLED",
  "PASSWORD_RESET_BY_ADMIN",
  "PASSWORD_CHANGED_BY_SELF",
  "LOGIN_SUCCEEDED",
  "LOGIN_FAILED",
  "STUDENT_CREATED",
  "STUDENT_UPDATED",
  // The Student ID moving, recorded separately from a general profile
  // edit because it also changes how the student signs in.
  "STUDENT_NUMBER_CHANGED",
  // Photographs. Separate from STUDENT_UPDATED because the payload of a
  // profile edit is the fields that changed, and an image has no useful
  // before/after to record there -- these carry the format and size only.
  "STUDENT_PHOTO_UPLOADED",
  "STUDENT_PHOTO_REPLACED",
  "STUDENT_PHOTO_REMOVED",
  "COURSE_CREDIT_HOURS_CHANGED",
  "PREREQUISITE_ADDED",
  "PREREQUISITE_REMOVED",
  "GRADE_SCALE_VERSION_CREATED",
  "INSTITUTION_SETTING_CHANGED",
  "CLASS_SHEET_PRINTED",
  "ACADEMIC_EXPORT_RUN",
  "AUDIT_LOG_VIEWED",

  // Stage 1 internal/test use only
  "TEST_ACTION",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
