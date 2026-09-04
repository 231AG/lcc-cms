import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

config({ path: ".env.local" });

/**
 * Idempotent reference-data seed (plan Section 30.3): the confirmed
 * nine-letter grade scale plus Incomplete (CR-01, CR-02, Section 16.2), and
 * the institution settings whose values are already fixed by the College's
 * decisions of 25 Aug 2026 (Section 38.5/38.6). Safe to run in every
 * environment, including production, because it only inserts rows that
 * don't already exist for policy_version 1.
 *
 * Demo/fixture data for tests is a SEPARATE script (added when Stage 3+
 * needs sample colleges/courses) and must refuse to run against production
 * -- do not add demo data here.
 */

const GRADE_SCALE_V1 = [
  { letter: "A+", minScore: 95, maxScore: 100, gradePoint: "4.00", isPassing: true, displayOrder: 1 },
  { letter: "A-", minScore: 90, maxScore: 94, gradePoint: "3.70", isPassing: true, displayOrder: 2 },
  { letter: "B+", minScore: 85, maxScore: 89, gradePoint: "3.30", isPassing: true, displayOrder: 3 },
  { letter: "B-", minScore: 80, maxScore: 84, gradePoint: "2.70", isPassing: true, displayOrder: 4 },
  { letter: "C+", minScore: 75, maxScore: 79, gradePoint: "2.30", isPassing: true, displayOrder: 5 },
  { letter: "C-", minScore: 70, maxScore: 74, gradePoint: "1.70", isPassing: true, displayOrder: 6 },
  { letter: "D+", minScore: 65, maxScore: 69, gradePoint: "1.30", isPassing: true, displayOrder: 7 },
  { letter: "D-", minScore: 60, maxScore: 64, gradePoint: "0.70", isPassing: true, displayOrder: 8 },
  { letter: "F", minScore: 0, maxScore: 59, gradePoint: "0.00", isPassing: false, displayOrder: 9 },
  // Incomplete: no score range, no grade point, excluded from every total
  // (REQ-C13). Not a repeat marker -- "R" is a display derivation, never a
  // stored grade_scale row.
  { letter: "I", minScore: null, maxScore: null, gradePoint: null, isPassing: false, displayOrder: 10 },
] as const;

/**
 * The permission matrix as data (plan Section 11.3), grown one action at a
 * time as each stage's real services are built. Stage 2 adds only the
 * identity/account rows -- no row exists yet for anything not built.
 */
const PERMISSIONS_STAGE_2: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "identity.changePassword", allowed: true, note: "Forced on first login and after any reset." },
  { role: "ADMIN", action: "identity.changePassword", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "identity.changePassword", allowed: true, note: "" },

  { role: "STUDENT", action: "identity.createStudentAccount", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.createStudentAccount", allowed: true, note: "REQ-A02" },
  { role: "SUPER_ADMIN", action: "identity.createStudentAccount", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "identity.resetStudentPassword", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.resetStudentPassword", allowed: true, note: "REQ-A02" },
  { role: "SUPER_ADMIN", action: "identity.resetStudentPassword", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "identity.createStaffAccount", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.createStaffAccount", allowed: false, note: "" },
  { role: "SUPER_ADMIN", action: "identity.createStaffAccount", allowed: true, note: "REQ-A06" },

  { role: "STUDENT", action: "identity.disableAccount", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.disableAccount", allowed: false, note: "" },
  { role: "SUPER_ADMIN", action: "identity.disableAccount", allowed: true, note: "Cannot disable the last active Super Admin (I-11)." },

  { role: "STUDENT", action: "identity.enableAccount", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.enableAccount", allowed: false, note: "" },
  { role: "SUPER_ADMIN", action: "identity.enableAccount", allowed: true, note: "" },
];

/** Stage 3: academic structure actions (Section 11.3 "Academic structure" group). */
const PERMISSIONS_STAGE_3: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "structure.manageCollege", allowed: false, note: "" },
  { role: "ADMIN", action: "structure.manageCollege", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "structure.manageCollege", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "structure.manageDepartment", allowed: false, note: "" },
  { role: "ADMIN", action: "structure.manageDepartment", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "structure.manageDepartment", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "structure.manageCourse", allowed: false, note: "" },
  { role: "ADMIN", action: "structure.manageCourse", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "structure.manageCourse", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "structure.managePrerequisite", allowed: false, note: "" },
  { role: "ADMIN", action: "structure.managePrerequisite", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "structure.managePrerequisite", allowed: false, note: "REQ-R04 explicit denial" },
];

/** Stage 4: calendar actions. transitionSemester is allowed for BOTH Admin
 * and Super Admin at this coarse-grained level -- the transition table
 * itself (semesterStateMachine.ts) enforces which role may perform which
 * SPECIFIC from/to pair, matching Section 11.4's "separation of duties
 * re-checked in-transaction" pattern rather than the permission table
 * trying to encode per-transition role logic. */
const PERMISSIONS_STAGE_4: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "calendar.manageAcademicYear", allowed: false, note: "" },
  { role: "ADMIN", action: "calendar.manageAcademicYear", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "calendar.manageAcademicYear", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "calendar.manageSemester", allowed: false, note: "" },
  { role: "ADMIN", action: "calendar.manageSemester", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "calendar.manageSemester", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "calendar.transitionSemester", allowed: false, note: "" },
  { role: "ADMIN", action: "calendar.transitionSemester", allowed: true, note: "Forward transitions only -- see semesterStateMachine.ts" },
  { role: "SUPER_ADMIN", action: "calendar.transitionSemester", allowed: true, note: "Backward/reopen only -- see semesterStateMachine.ts" },
];

/** Stage 5: student profile edits (name, department, enrolment year,
 * contact, status -- including reactivation). identity.createStudentAccount
 * and identity.resetStudentPassword were already seeded in Stage 2, per
 * REQ-T02's traceability, ahead of the feature that uses them. */
const PERMISSIONS_STAGE_5: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "identity.updateStudentProfile", allowed: false, note: "" },
  { role: "ADMIN", action: "identity.updateStudentProfile", allowed: true, note: "" },
  { role: "SUPER_ADMIN", action: "identity.updateStudentProfile", allowed: false, note: "REQ-R04 explicit denial (DEV-04 confirmed no exception for reactivation)" },
];

/** Stage 6: historical import. Admin only throughout -- Super Admin
 * refused entering, correcting, or voiding historical records (Section
 * 11.2/11.3); Super Admin gets read-only access to the progress report. */
const PERMISSIONS_STAGE_6: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "historical.enterRecord", allowed: false, note: "" },
  { role: "ADMIN", action: "historical.enterRecord", allowed: true, note: "REQ-H01/H02" },
  { role: "SUPER_ADMIN", action: "historical.enterRecord", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "historical.correctRecord", allowed: false, note: "" },
  { role: "ADMIN", action: "historical.correctRecord", allowed: true, note: "DEV-05: direct correction, no two-key approval yet" },
  { role: "SUPER_ADMIN", action: "historical.correctRecord", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "historical.voidRecord", allowed: false, note: "" },
  { role: "ADMIN", action: "historical.voidRecord", allowed: true, note: "Wrong-student entry; row marked void, never deleted" },
  { role: "SUPER_ADMIN", action: "historical.voidRecord", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "historical.setImportStatus", allowed: false, note: "" },
  { role: "ADMIN", action: "historical.setImportStatus", allowed: true, note: "Mark Complete, or reopen with a mandatory reason" },
  { role: "SUPER_ADMIN", action: "historical.setImportStatus", allowed: false, note: "REQ-R04 explicit denial" },

  { role: "STUDENT", action: "historical.createRetrospectiveSemester", allowed: false, note: "" },
  { role: "ADMIN", action: "historical.createRetrospectiveSemester", allowed: true, note: "Created directly Closed (ASM-15), bypasses the forward state machine" },
  { role: "SUPER_ADMIN", action: "historical.createRetrospectiveSemester", allowed: false, note: "REQ-R04 explicit denial" },
];

/** Stage 8: course offerings and scheduling. One permission covers
 * offering CRUD, publish/cancel, and meeting-time management -- they're
 * always performed by the same actor under the same rule (Admin only,
 * Super Admin explicitly denied, REQ-R04), so there's nothing a finer
 * split would buy here the way calendar.ts's three separate actions did
 * (those needed to distinguish Admin-forward from Super-Admin-backward). */
const PERMISSIONS_STAGE_8: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "offering.manage", allowed: false, note: "" },
  { role: "ADMIN", action: "offering.manage", allowed: true, note: "Covers offering CRUD, publish/cancel, and meeting-time management" },
  { role: "SUPER_ADMIN", action: "offering.manage", allowed: false, note: "REQ-R04 explicit denial" },
];

/** Stage 9: course planning and approval. Split along "who does it" --
 * a student manages only their own plan (create/edit/submit/delete/revise
 * while DRAFT or REJECTED); an Admin reviews plans (approve, reject,
 * override a failed prerequisite -- always the same actor and rule, one
 * permission, same reasoning as Stage 8's offering.manage); and Admin
 * direct registration/drop (DEC-14) is kept as its own permission since
 * it's a materially different action (bypassing the plan entirely) even
 * though the actor and allow/deny shape are identical. Super Admin is
 * refused everywhere in this domain (Section 9.4.9: "Super Admin has no
 * role here at all") -- not even read-only, unlike most other tables. */
const PERMISSIONS_STAGE_9: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "planning.manageOwnPlan", allowed: true, note: "REQ-P01/P02. Own plan only, only while DRAFT or REJECTED, only during Registration." },
  { role: "ADMIN", action: "planning.manageOwnPlan", allowed: false, note: "" },
  { role: "SUPER_ADMIN", action: "planning.manageOwnPlan", allowed: false, note: "Section 9.4.9: Super Admin has no role in course planning at all." },

  { role: "STUDENT", action: "planning.reviewPlan", allowed: false, note: "" },
  { role: "ADMIN", action: "planning.reviewPlan", allowed: true, note: "REQ-P10/P11. Approve, reject with reason, override a failed prerequisite." },
  { role: "SUPER_ADMIN", action: "planning.reviewPlan", allowed: false, note: "Section 9.4.9: Super Admin has no role in course planning at all." },

  // DEV-20: entering a course plan on behalf of a student who cannot use
  // the app themselves. Distinct from manageOwnPlan (which is a student
  // acting on their own row) and from reviewPlan (deciding a submitted
  // plan) -- an Admin who may review is not automatically one who may
  // author, and this keeps the two nameable separately if that ever
  // matters. Super Admin stays out, as in every other planning action.
  { role: "STUDENT", action: "planning.manageStudentPlan", allowed: false, note: "A student uses planning.manageOwnPlan for their own plan." },
  { role: "ADMIN", action: "planning.manageStudentPlan", allowed: true, note: "DEV-20. Build and submit a course plan on a student's behalf; same validators and same approval queue as a student-submitted plan." },
  { role: "SUPER_ADMIN", action: "planning.manageStudentPlan", allowed: false, note: "Section 9.4.9: Super Admin has no role in course planning at all." },

  { role: "STUDENT", action: "planning.manageRegistration", allowed: false, note: "" },
  { role: "ADMIN", action: "planning.manageRegistration", allowed: true, note: "DEC-14. Direct registration and drop, bypassing the plan." },
  { role: "SUPER_ADMIN", action: "planning.manageRegistration", allowed: false, note: "Section 9.4.9: Super Admin has no role in course planning at all." },
];

/** Stage 10: grade management lifecycle. Split along "who does it,"
 * matching Stage 9's precedent -- draft entry and submission are the same
 * Admin doing sequential steps on their own class (one permission,
 * same reasoning as Stage 8 folding create/publish/cancel together);
 * approval/rejection and correction decisions are Super Admin's alone;
 * requesting a correction is Admin's. Unlike Stage 9, Super Admin is a
 * genuine actor here (REQ-R04 does not blanket-refuse this domain) --
 * the two-key grading control depends on Super Admin actually doing
 * something, not being excluded. */
const PERMISSIONS_STAGE_10: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "grade.manageClass", allowed: false, note: "" },
  { role: "ADMIN", action: "grade.manageClass", allowed: true, note: "REQ-G05. Draft entry/edit/clear and submission of a class's grades. Cannot approve own submission." },
  { role: "SUPER_ADMIN", action: "grade.manageClass", allowed: false, note: "Cannot enter or edit a grade (Section 15.1)." },

  { role: "STUDENT", action: "grade.review", allowed: false, note: "" },
  { role: "ADMIN", action: "grade.review", allowed: false, note: "Cannot approve or reject a submission (Section 15.1)." },
  { role: "SUPER_ADMIN", action: "grade.review", allowed: true, note: "REQ-G06/CR-06. Approve or reject a submission, as a batch or individual grades within it." },

  { role: "STUDENT", action: "grade.requestCorrection", allowed: false, note: "" },
  { role: "ADMIN", action: "grade.requestCorrection", allowed: true, note: "REQ-R06/REQ-G08. Old value, new value and reason captured at request time." },
  { role: "SUPER_ADMIN", action: "grade.requestCorrection", allowed: false, note: "" },

  { role: "STUDENT", action: "grade.decideCorrection", allowed: false, note: "" },
  { role: "ADMIN", action: "grade.decideCorrection", allowed: false, note: "" },
  { role: "SUPER_ADMIN", action: "grade.decideCorrection", allowed: true, note: "Approver must not be the requester -- enforced again here even though the DB check constraint already guarantees it." },
];

/* Stage 11 (Hardening, Export, Backup and Go-Live). Matches the plan's own
 * permission matrix (Section 11.3): the semester-end export may be run by
 * either staff role, but the audit log itself is Super Admin-only (REQ-R08),
 * and reading it is logged like any other action. The grading-policy view
 * (X-08) is read-only for everyone who can already see grades in some form;
 * changing the policy remains the existing grade-scale action, unchanged. */
const PERMISSIONS_STAGE_11: Array<{
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN";
  action: string;
  allowed: boolean;
  note: string;
}> = [
  { role: "STUDENT", action: "export.runSemesterExport", allowed: false, note: "" },
  { role: "ADMIN", action: "export.runSemesterExport", allowed: true, note: "Section 11.3. Full copy of a semester's academic data leaves the system; every run is audited (ACADEMIC_EXPORT_RUN)." },
  { role: "SUPER_ADMIN", action: "export.runSemesterExport", allowed: true, note: "Section 11.3." },

  { role: "STUDENT", action: "audit.view", allowed: false, note: "" },
  { role: "ADMIN", action: "audit.view", allowed: false, note: "REQ-R08. Audit log is Super Admin-only (Section 11.3)." },
  { role: "SUPER_ADMIN", action: "audit.view", allowed: true, note: "REQ-R08. Reading the log is itself logged (AUDIT_LOG_VIEWED)." },

  { role: "STUDENT", action: "gradingPolicy.view", allowed: true, note: "X-08. Read-only view of the active grade scale." },
  { role: "ADMIN", action: "gradingPolicy.view", allowed: true, note: "X-08." },
  { role: "SUPER_ADMIN", action: "gradingPolicy.view", allowed: true, note: "X-08." },
];

const INSTITUTION_SETTINGS: Array<{ key: string; value: unknown; description: string }> = [
  { key: "max_credits_per_semester", value: 21, description: "REQ-C12, CR-04. Institution default; a department may set a lower ceiling, never higher." },
  { key: "credits_to_graduate", value: 132, description: "REQ-C12, CR-04. Displayed progress figure only; gates nothing in Phase 1." },
  { key: "gpa_decimal_places", value: 3, description: "REQ-C10, CR-03. Half-up, applied once at presentation." },
  { key: "passing_grade_point", value: "0.70", description: "REQ-C11, CR-05. Minimum passing grade is D- (0.70)." },
  { key: "incomplete_resolution_semesters", value: 1, description: "REQ-C14, CR-13. An Incomplete must be resolved within one semester." },
  { key: "academic_standing_probation_below", value: "2.000", description: "REQ-C15, CR-14." },
  { key: "academic_standing_honours_at_or_above", value: "3.500", description: "REQ-C15, CR-14." },
  { key: "institution_display_timezone", value: "Africa/Monrovia", description: "DER-27." },
  { key: "prerequisite_override_enabled", value: false, description: "DEC-12 -- still open. Enable with an expiry date before Stage 9 UAT." },
  // prerequisite_override_expiry (DEC-12) is deliberately NOT seeded: jsonb
  // is NOT NULL on this table, and an absent key is exactly "no window
  // configured" -- the same meaning a null value would carry, without
  // needing a NOT NULL workaround. Set at go-live (Section 14.5/17.8), by
  // inserting the key once a real date is chosen.
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }

  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  console.log("Seeding grade_scale (policy version 1)...");
  for (const entry of GRADE_SCALE_V1) {
    await db
      .insert(schema.gradeScale)
      .values({
        policyVersion: 1,
        letter: entry.letter,
        minScore: entry.minScore,
        maxScore: entry.maxScore,
        gradePoint: entry.gradePoint,
        countsInGpa: entry.letter !== "I",
        countsInAttempted: entry.letter !== "I",
        countsInEarned: entry.isPassing,
        isPassing: entry.isPassing,
        displayOrder: entry.displayOrder,
      })
      .onConflictDoNothing();
  }

  console.log("Seeding permission (Stage 2 + 3 + 4 + 5 + 6 + 8 + 9 + 10 + 11 actions)...");
  for (const row of [...PERMISSIONS_STAGE_2, ...PERMISSIONS_STAGE_3, ...PERMISSIONS_STAGE_4, ...PERMISSIONS_STAGE_5, ...PERMISSIONS_STAGE_6, ...PERMISSIONS_STAGE_8, ...PERMISSIONS_STAGE_9, ...PERMISSIONS_STAGE_10, ...PERMISSIONS_STAGE_11]) {
    await db
      .insert(schema.permission)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.permission.role, schema.permission.action],
        set: { allowed: row.allowed, note: row.note },
      });
  }

  console.log("Seeding institution_setting...");
  for (const setting of INSTITUTION_SETTINGS) {
    await db
      .insert(schema.institutionSetting)
      .values({
        key: setting.key,
        value: setting.value,
        description: setting.description,
      })
      .onConflictDoNothing();
  }

  console.log("Seed complete.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
