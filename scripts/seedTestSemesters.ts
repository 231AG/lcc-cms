/**
 * Seeds one semester per state of the four-state lifecycle, so each state
 * can be exercised in a real environment without touching a real semester.
 *
 * These are unmistakably test records, by three separate signals:
 *
 *   1. They hang off their own academic year, labelled with a far-future
 *      pair of years (2090/2091) that no real record will ever use.
 *   2. Every semester name is prefixed with the literal "TEST —".
 *   3. Nothing else references them: no offerings, no plans, no
 *      registrations, no grades. They are empty shells whose only content
 *      is their state.
 *
 * The whole set can be removed again with --remove, which is safe precisely
 * because nothing points at them.
 *
 * The states are written directly rather than walked through
 * transitionSemester(), on purpose: the guard that allows at most one Open
 * and one In Progress semester at a time exists to protect the real
 * calendar, and driving test fixtures through it would either fail against a
 * live semester or, worse, appear to succeed while blocking the real one.
 * Writing the rows is a fixture concern; the transition rules are tested by
 * semesterStateMachine.test.ts and calendar.integration.test.ts.
 *
 * Run with:     npx tsx scripts/seedTestSemesters.ts
 * Remove with:  npx tsx scripts/seedTestSemesters.ts --remove
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const TEST_NAME_PREFIX = "TEST — ";
const REMOVE = process.argv.includes("--remove");

/** One per state, in lifecycle order. Sequence is 1 or 2 by CR-10, and a
 *  year holds exactly two semesters -- so the four fixtures need two years. */
const FIXTURES = [
  { state: "DRAFT", name: "Draft semester", yearOffset: 0, sequence: 1 },
  { state: "OPEN", name: "Open semester", yearOffset: 0, sequence: 2 },
  { state: "IN_PROGRESS", name: "In Progress semester", yearOffset: 1, sequence: 1 },
  { state: "CLOSED", name: "Closed semester", yearOffset: 1, sequence: 2 },
] as const;

function yearLabel(offset: number): string {
  const start = 2090 + offset * 2;
  return `${start}/${start + 1}`;
}

async function main() {
  const { db } = await import("../src/lib/db/client");
  const { academicYear, semester } = await import("../src/lib/db/schema/calendar");
  const { eq, inArray, like } = await import("drizzle-orm");

  if (REMOVE) {
    const years = await db.query.academicYear.findMany({ where: like(academicYear.label, "209%") });
    const yearIds = years.map((y) => y.id);
    if (yearIds.length === 0) {
      console.log("No test academic years found. Nothing to remove.");
      return;
    }
    const removedSemesters = await db.delete(semester).where(inArray(semester.academicYearId, yearIds)).returning();
    const removedYears = await db.delete(academicYear).where(inArray(academicYear.id, yearIds)).returning();
    console.log(`Removed ${removedSemesters.length} test semester(s) and ${removedYears.length} test academic year(s).`);
    return;
  }

  for (const [offset, label] of [yearLabel(0), yearLabel(1)].entries()) {
    const existing = await db.query.academicYear.findFirst({ where: eq(academicYear.label, label) });
    if (existing) {
      console.log(`Academic year ${label} already exists — reusing it.`);
      continue;
    }
    const startYear = 2090 + offset * 2;
    await db.insert(academicYear).values({
      label,
      startDate: `${startYear}-09-01`,
      endDate: `${startYear + 1}-06-30`,
      isCurrent: false,
    });
    console.log(`Created test academic year ${label}.`);
  }

  for (const fixture of FIXTURES) {
    const label = yearLabel(fixture.yearOffset);
    const year = await db.query.academicYear.findFirst({ where: eq(academicYear.label, label) });
    if (!year) throw new Error(`Test academic year ${label} is missing — cannot seed ${fixture.state}.`);

    const name = `${TEST_NAME_PREFIX}${fixture.name}`;
    const already = await db.query.semester.findFirst({ where: eq(semester.name, name) });
    if (already) {
      // Idempotent: re-running resets the state rather than duplicating a row,
      // which is what you want after clicking a fixture through a transition.
      await db.update(semester).set({ state: fixture.state }).where(eq(semester.id, already.id));
      console.log(`  ${name} already existed — state reset to ${fixture.state}.`);
      continue;
    }

    const startYear = Number(label.slice(0, 4));
    const [row] = await db
      .insert(semester)
      .values({
        academicYearId: year.id,
        sequence: fixture.sequence,
        name,
        state: fixture.state,
        startDate: fixture.sequence === 1 ? `${startYear}-09-01` : `${startYear + 1}-01-15`,
        endDate: fixture.sequence === 1 ? `${startYear}-12-20` : `${startYear + 1}-06-30`,
      })
      .returning();
    console.log(`  Created ${name} (${fixture.state}) — ${row.id}`);
  }

  console.log(
    `\nDone. Four test semesters exist under academic years ${yearLabel(0)} and ${yearLabel(1)}, ` +
      `each named "${TEST_NAME_PREFIX}...". Remove them with: npx tsx scripts/seedTestSemesters.ts --remove`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
