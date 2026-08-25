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
