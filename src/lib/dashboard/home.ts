import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courseOffering, gradeRecord, gradeSubmission, registration, semester } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { getPlanQueue } from "@/lib/planning/planning";
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

  let plansAwaitingApproval = 0;
  for (const sem of activeSemesters) {
    const queue = await getPlanQueue(actor, sem.id);
    plansAwaitingApproval += queue.length;
  }

  await assertCan(actor, "grade.manageClass");
  const gradeSemesterIds = activeSemesters.filter((s) => s.state === "GRADE_SUBMISSION").map((s) => s.id);
  let classesNotYetSubmitted = 0;
  if (gradeSemesterIds.length > 0) {
    const offerings = await db.query.courseOffering.findMany({ where: inArray(courseOffering.semesterId, gradeSemesterIds) });
    const offeringsWithRegistrations = new Set(
      (await db.query.registration.findMany({ where: and(inArray(registration.offeringId, offerings.map((o) => o.id)), eq(registration.status, "REGISTERED")) })).map(
        (r) => r.offeringId,
      ),
    );
    const submittedOfferingIds = new Set(
      (await db.query.gradeSubmission.findMany({ where: inArray(gradeSubmission.offeringId, offerings.map((o) => o.id)) })).map((s) => s.offeringId),
    );
    classesNotYetSubmitted = offerings.filter((o) => offeringsWithRegistrations.has(o.id) && !submittedOfferingIds.has(o.id)).length;
  }

  // A grade returned to DRAFT with a decision_reason set is one that was
  // rejected and never resubmitted -- decideGrades (grades.ts) is the only
  // place that sets both at once.
  const rejectedGrades = await db.query.gradeRecord.findMany({
    where: and(eq(gradeRecord.status, "DRAFT"), isNotNull(gradeRecord.decisionReason)),
  });

  const progress = await getImportProgressReport(actor);

  return {
    plansAwaitingApproval,
    classesNotYetSubmitted,
    rejectedGradesNeedingRework: rejectedGrades.length,
    importByStatus: progress.byStatus,
  };
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
