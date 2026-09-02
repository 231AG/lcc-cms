/**
 * Removes every demo student created for the walkthrough dataset (see the
 * project's DECISIONS.md entry for that seeding pass) and nothing else.
 *
 * Demo students are identified the same way an Admin would find them in the
 * UI: firstName === "Demo Student —" (the literal marker every seeded
 * account was given, e.g. "Demo Student — Grace Kollie"). No other student
 * row, real or otherwise, uses that firstName.
 *
 * Deletes in FK-safe order (every relevant FK in this schema is `restrict`,
 * not `cascade`): registration -> course_plan_item -> course_plan ->
 * academic_record -> student_semester_summary -> student_cumulative_summary
 * -> student -> app_user -> the Supabase Auth user. audit_log rows are left
 * alone on purpose -- that table has no FK to student by design (it's
 * append-only and must survive the entities it describes being deleted).
 *
 * The 2026/2027 First Semester's REGISTRATION state and the two
 * retrospective historical semesters created for this data are NOT touched
 * here -- those are calendar-level decisions, left for a human to make
 * separately.
 *
 * Run with: npx tsx scripts/removeDemoData.ts
 * Preview first with: npx tsx scripts/removeDemoData.ts --dry-run
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DEMO_FIRST_NAME = "Demo Student —";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { db } = await import("../src/lib/db/client");
  const { student } = await import("../src/lib/db/schema/student");
  const { appUser } = await import("../src/lib/db/schema/identity");
  const { registration, coursePlan, coursePlanItem } = await import("../src/lib/db/schema/planning");
  const { academicRecord } = await import("../src/lib/db/schema/academicRecord");
  const { studentSemesterSummary, studentCumulativeSummary } = await import("../src/lib/db/schema/gpa");
  const { eq, inArray } = await import("drizzle-orm");
  const { createAdminClient } = await import("../src/lib/supabase/admin");

  const demoStudents = await db.query.student.findMany({ where: eq(student.firstName, DEMO_FIRST_NAME) });

  if (demoStudents.length === 0) {
    console.log("No demo students found (firstName === \"Demo Student —\"). Nothing to do.");
    process.exit(0);
  }

  console.log(`Found ${demoStudents.length} demo student(s):`);
  for (const s of demoStudents) console.log(`  ${s.studentNumber}  ${s.firstName} ${s.lastName}`);

  const studentIds = demoStudents.map((s) => s.id);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing deleted. Re-run without --dry-run to actually remove this data.");
    process.exit(0);
  }

  const admin = createAdminClient();

  const plans = await db.query.coursePlan.findMany({ where: inArray(coursePlan.studentId, studentIds) });
  const planIds = plans.map((p) => p.id);

  await db.transaction(async (tx) => {
    if (studentIds.length > 0) {
      await tx.delete(registration).where(inArray(registration.studentId, studentIds));
    }
    if (planIds.length > 0) {
      await tx.delete(coursePlanItem).where(inArray(coursePlanItem.planId, planIds));
    }
    if (studentIds.length > 0) {
      await tx.delete(coursePlan).where(inArray(coursePlan.studentId, studentIds));
      await tx.delete(academicRecord).where(inArray(academicRecord.studentId, studentIds));
      await tx.delete(studentSemesterSummary).where(inArray(studentSemesterSummary.studentId, studentIds));
      await tx.delete(studentCumulativeSummary).where(inArray(studentCumulativeSummary.studentId, studentIds));
      await tx.delete(student).where(inArray(student.id, studentIds));
      await tx.delete(appUser).where(inArray(appUser.id, studentIds));
    }
  });
  console.log("Deleted database rows (registrations, plans, academic records, summaries, student, app_user).");

  for (const s of demoStudents) {
    const { error } = await admin.auth.admin.deleteUser(s.id);
    if (error) {
      console.error(`  Failed to delete Auth user for ${s.studentNumber}: ${error.message}`);
    } else {
      console.log(`  Deleted Auth user for ${s.studentNumber}`);
    }
  }

  console.log("\nDone. Note: the 2026/2027 First Semester is still in REGISTRATION state, and the two");
  console.log("retrospective historical semesters (2024/2025 and 2025/2026 Second Semester) still exist");
  console.log("with no records against them -- left as-is; delete/revert those manually if you want them gone too.");

  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
