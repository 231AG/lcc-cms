/**
 * How `student.status` reads on screen, now that it is shown as
 * "Enrollment": whether the student is enrolled at all. (A student's
 * "Status" in the College's own sense is their level -- see level.ts.)
 *
 * One map, used by every screen that shows it, so "ADMISSION_FORFEITED"
 * never reaches a reader as a database constant.
 */
export const ENROLLMENT_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  SUSPENDED: "Suspended",
  GRADUATED: "Graduated",
  ADMISSION_FORFEITED: "Admission forfeited",
};

export function enrollmentLabel(status: string): string {
  return ENROLLMENT_LABEL[status] ?? status;
}
