// Throwaway smoke test: exercises the new Stage 11 read services directly
// against the local DB, without a browser session, to catch query-syntax
// errors before relying on manual UI testing.
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { getAuditLogPage } from "@/lib/audit/query";
import { getGradingPolicy } from "@/lib/grading/policy";
import { getImportProgressReport } from "@/lib/historical/historical";
import { countUnpublishedGrades } from "@/lib/export/academicExport";
import { getAdminHomeSummary, getSuperAdminHomeSummary } from "@/lib/dashboard/home";

async function main() {
  const superAdmin = await db.query.appUser.findFirst({ where: and(eq(appUser.role, "SUPER_ADMIN"), eq(appUser.status, "ACTIVE")) });
  if (!superAdmin) throw new Error("No Super Admin fixture found -- run `npm run test:fixtures` first.");
  const actor = { userId: superAdmin.id, role: "SUPER_ADMIN" as const };

  console.log("getAuditLogPage...");
  const auditPage = await getAuditLogPage(actor, {}, 0);
  console.log(`  ok: ${auditPage.groups.length} group(s), hasMore=${auditPage.hasMore}`);

  console.log("getGradingPolicy...");
  const policy = await getGradingPolicy(actor);
  console.log(`  ok: version ${policy.activeVersion}, ${policy.scale.length} scale row(s), ${policy.settings.length} setting(s), ${policy.versionHistory.length} version(s) in history`);

  console.log("getImportProgressReport...");
  const progress = await getImportProgressReport(actor);
  console.log(`  ok: ${progress.totalStudents} student(s), ${progress.byDepartment.length} dept row(s), ${progress.byCohort.length} cohort row(s), ${progress.recordsEnteredPerWeek.length} week(s)`);

  console.log("countUnpublishedGrades (no semesters is fine, expect 0)...");
  const count = await countUnpublishedGrades("00000000-0000-0000-0000-000000000000");
  console.log(`  ok: ${count}`);

  console.log("getSuperAdminHomeSummary...");
  const xoneSummary = await getSuperAdminHomeSummary(actor);
  console.log(`  ok: ${xoneSummary.submissionsAwaitingApproval} submission(s), ${xoneSummary.correctionsAwaitingDecision} correction(s), ${xoneSummary.semesterStates.length} semester(s)`);

  console.log("getAdminHomeSummary (using a throwaway Admin fixture)...");
  let adminUser = await db.query.appUser.findFirst({ where: and(eq(appUser.role, "ADMIN"), eq(appUser.status, "ACTIVE")) });
  if (!adminUser) {
    const id = randomUUID();
    [adminUser] = await db.insert(appUser).values({ id, loginIdentifier: "smoke-test-admin", displayName: "Smoke Test Admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false }).returning();
  }
  const adminActor = { userId: adminUser.id, role: "ADMIN" as const };
  const aoneSummary = await getAdminHomeSummary(adminActor);
  console.log(`  ok: ${aoneSummary.plansAwaitingApproval} plan(s), ${aoneSummary.classesNotYetSubmitted} class(es), ${aoneSummary.rejectedGradesNeedingRework} rejected grade(s)`);

  console.log("\nAll smoke checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
