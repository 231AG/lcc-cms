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
  "COURSE_PLAN_ITEM_APPROVED",
  "COURSE_PLAN_ITEM_REJECTED",
  "PREREQUISITE_OVERRIDDEN",
  "REGISTRATION_CREATED",
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
