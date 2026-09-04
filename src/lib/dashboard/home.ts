import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courseOffering, gradeRecord, gradeSubmission, registration, semester } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { countPlansAwaitingApproval } from "@/lib/planning/planning";
import { getSubmissionQueue, getCorrectionQueue } from "@/lib/grades/grades";
import { getImportProgressReport } from "@/lib/historical/historical";

const ACTIVE_STATES = ["OPEN", "REGISTRATION", "IN_PROGRESS", "GRADE_SUBMISSION"] as const;

async function getActiveSemesters() {
  return db.query.semester.findMany({ where: inArray(semester.state, [...ACTIVE_STATES]) });
}

export interface AdminHomeSummary {
  plansAwaitingApproval: number;
  classesNotYetSubmitted: number;
  rejectedGradesNeedingRework: number;
  importByStatus: Record<string, number>;
}

/**
 * A-01 (plan Section 20.4): "Work queues: plans awaiting approval, classes
 * with grades not yet submitted, submissions rejected and needing rework,
 * import progress summary. Queues, not analytics." Aggregates existing,
 * already-permission-gated queue functions rather than re-implementing
 * their access rules here.
 */
export async function getAdminHomeSummary(actor: Actor): Promise<AdminHomeSummary> {
  const activeSemesters = await getActiveSemesters();
  await assertCan(actor, "grade.manageClass");
  const gradeSemesterIds = activeSemesters.filter((s) => s.state === "GRADE_SUBMISSION").map((s) => s.id);

  // This dashboard is the first screen an Admin sees, and it was the
  // slowest page in the app. Two reasons, both fixed here: it counted
  // pending plans with one round trip PER active semester (fetching whole
  // rows only to read `.length`), and every one of its four independent
  // figures was awaited in series. They share no data, so they now run
  // together and the plan count is a single COUNT in the database.
  const [plansAwaitingApproval, classesNotYetSubmitted, rejectedGrades, progress] = await Promise.all([
    countPlansAwaitingApproval(actor, activeSemesters.map((s) => s.id)),
    countClassesNotYetSubmitted(gradeSemesterIds),
    // A grade returned to DRAFT with a decision_reason set is one that was
    // rejected and never resubmitted -- decideGrades (grades.ts) is the
    // only place that sets both at once.
    db.query.gradeRecord.findMany({
      where: and(eq(gradeRecord.status, "DRAFT"), isNotNull(gradeRecord.decisionReason)),
    }),
    getImportProgressReport(actor),
  ]);

  return {
    plansAwaitingApproval,
    classesNotYetSubmitted,
    rejectedGradesNeedingRework: rejectedGrades.length,
    importByStatus: progress.byStatus,
  };
}

/** Classes in a grade-submission semester that have registered students
 * but no grade submission yet. The two lookups after the offering list
 * depend only on it, not on each other, so they run together. */
async function countClassesNotYetSubmitted(gradeSemesterIds: string[]): Promise<number> {
  if (gradeSemesterIds.length === 0) return 0;

  const offerings = await db.query.courseOffering.findMany({ where: inArray(courseOffering.semesterId, gradeSemesterIds) });
  if (offerings.length === 0) return 0;
  const offeringIds = offerings.map((o) => o.id);

  const [registrations, submissions] = await Promise.all([
    db.query.registration.findMany({ where: and(inArray(registration.offeringId, offeringIds), eq(registration.status, "REGISTERED")) }),
    db.query.gradeSubmission.findMany({ where: inArray(gradeSubmission.offeringId, offeringIds) }),
  ]);

  const withRegistrations = new Set(registrations.map((r) => r.offeringId));
  const submitted = new Set(submissions.map((s) => s.offeringId));
  return offerings.filter((o) => withRegistrations.has(o.id) && !submitted.has(o.id)).length;
}

export interface SuperAdminHomeSummary {
  submissionsAwaitingApproval: number;
  correctionsAwaitingDecision: number;
  semesterStates: Array<{ id: string; label: string; state: string }>;
}

/** X-01 (plan Section 20.5): two queues plus semester states at a glance. */
export async function getSuperAdminHomeSummary(actor: Actor): Promise<SuperAdminHomeSummary> {
  const [submissions, corrections, semesters, years] = await Promise.all([
    getSubmissionQueue(actor),
    getCorrectionQueue(actor),
    db.query.semester.findMany({ orderBy: (t, { desc }) => [desc(t.academicYearId), desc(t.sequence)] }),
    db.query.academicYear.findMany(),
  ]);
  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? id;

  return {
    submissionsAwaitingApproval: submissions.filter((s) => s.status !== "CLOSED").length,
    correctionsAwaitingDecision: corrections.length,
    semesterStates: semesters.map((s) => ({ id: s.id, label: `${yearLabel(s.academicYearId)} — ${s.name}`, state: s.state })),
  };
}
