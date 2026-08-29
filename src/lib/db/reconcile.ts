import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { reconcileSummariesMatchEngine, reconcileRepeatResolutionCoherence, reconcilePublishedGradesHaveRecords } from "@/lib/gpa/reconciliation";

config({ path: ".env.local" });

/**
 * Section 22.4's three reconciliation queries, packaged as one runnable
 * check (Stage 11 Database scope): "run before every go-live and at every
 * semester end." Exits non-zero if anything is found, so it can gate a
 * deploy or a semester-close procedure in addition to being run by hand.
 *
 * The summaries/repeat-coherence checks (I-15, I-16) self-heal any drift
 * they find by design (see reconciliation.ts) -- this script lets that
 * write commit, matching the plan's own description of I-15 as
 * "recomputed transactionally." The published-grades check (I-05) is
 * strictly read-only; a mismatch there is reported, never auto-fixed.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  let exitCode = 0;

  try {
    const students = await db.query.student.findMany({ columns: { id: true } });
    const studentIds = students.map((s) => s.id);
    console.log(`Reconciling ${studentIds.length} student(s)...\n`);

    const summaryMismatches = await db.transaction((tx) => reconcileSummariesMatchEngine(tx, studentIds));
    console.log(`[I-15] Summaries match engine: ${summaryMismatches.length === 0 ? "OK (zero differences)" : `${summaryMismatches.length} MISMATCH(ES) FOUND AND CORRECTED`}`);
    for (const m of summaryMismatches) console.log(`  - student ${m.studentId}, ${m.field}: stored=${m.stored} recomputed=${m.recomputed}`);
    if (summaryMismatches.length > 0) exitCode = 1;

    const repeatIssues = await db.transaction((tx) => reconcileRepeatResolutionCoherence(tx, studentIds));
    console.log(`[I-16] Repeat resolution is coherent: ${repeatIssues.length === 0 ? "OK (zero rows)" : `${repeatIssues.length} ISSUE(S) FOUND`}`);
    for (const i of repeatIssues) console.log(`  - student ${i.studentId}, course ${i.courseCodeKey}: ${i.keptCount} non-dropped records (expected 1)`);
    if (repeatIssues.length > 0) exitCode = 1;

    const gradeMismatches = await db.transaction((tx) => reconcilePublishedGradesHaveRecords(tx));
    console.log(`[I-05] Published grades have records: ${gradeMismatches.length === 0 ? "OK (zero rows)" : `${gradeMismatches.length} MISMATCH(ES) FOUND`}`);
    for (const m of gradeMismatches) console.log(`  - ${m.kind}: grade_record=${m.gradeRecordId} academic_record=${m.academicRecordId ?? "none"}`);
    if (gradeMismatches.length > 0) exitCode = 1;

    console.log(`\nReconciliation ${exitCode === 0 ? "PASSED" : "FAILED"}.`);
  } finally {
    await client.end();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
