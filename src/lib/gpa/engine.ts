import Decimal from "decimal.js";

/**
 * The GPA/CGPA engine (plan Section 16). A pure function: takes records and
 * a policy object, returns figures. No database access, no I/O -- callers
 * fetch data and pass it in, so the same inputs always give the same
 * outputs and the tests (Appendix B's 47 fixtures) are trustworthy
 * (Section 16.1, DER-09, P3).
 *
 * Exact decimal arithmetic throughout, via decimal.js -- never a native JS
 * `number` in the calculation path. Grade points of 3.70 and 2.30 are
 * exactly the values that expose binary floating point (3.6999999999999997
 * and disputes); DER-08/TEC-09 forbid it everywhere, including JSON
 * serialisation, which is why every value in and out of this module is a
 * decimal string, not a `number`.
 */

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export interface GpaPolicy {
  /** "0.70" -- the minimum passing grade point (D-). */
  passingGradePoint: string;
  /** "MOST_RECENT" (the implemented default) or "BEST", for ASM-19's fixture-protected policy switch. */
  repeatPolicy: "MOST_RECENT" | "BEST";
  /** "3.500" -- CGPA at or above this is Honours. */
  standingHonoursAt: string;
  /** "2.000" -- CGPA below this is Probation; at or above (and below Honours) is Good standing. */
  standingProbationBelow: string;
  /** 132 -- credit hours required to graduate. */
  graduationCreditHours: number;
}

export const DEFAULT_GPA_POLICY: GpaPolicy = {
  passingGradePoint: "0.70",
  repeatPolicy: "MOST_RECENT",
  standingHonoursAt: "3.500",
  standingProbationBelow: "2.000",
  graduationCreditHours: 132,
};

/**
 * Chronological position of a semester: academic year's starting
 * calendar year, then sequence (1 = First, 2 = Second). Compared
 * lexicographically -- this is how "most recent attempt" and "latest
 * semester" are determined, never by insertion order or record id
 * (fixture F-16).
 */
export interface SemesterSortKey {
  yearStart: number;
  sequence: 1 | 2;
}

function compareSortKey(a: SemesterSortKey, b: SemesterSortKey): number {
  if (a.yearStart !== b.yearStart) return a.yearStart - b.yearStart;
  return a.sequence - b.sequence;
}

/** One academic_record, exactly the frozen fields the engine needs. */
export interface EngineRecord {
  id: string;
  courseCodeKey: string; // normalized course code -- the repeat-grouping key (Section 9.4.14's own uniqueness key)
  semesterId: string;
  semesterSortKey: SemesterSortKey;
  creditHours: string; // decimal string
  gradePoint: string | null; // decimal string; null for a grade with no grade point (Incomplete)
  countsInGpa: boolean;
  countsInAttempted: boolean;
  countsInEarned: boolean;
  wasMajorAtRecord: boolean;
  letter: string;
}

// ---------------------------------------------------------------------------
// Rounding (DEC-07, Section 16.5's "ROUNDING")
// ---------------------------------------------------------------------------

/** Half-up rounding to `places` decimal places, returned as a fixed-format decimal string. */
export function roundHalfUp(value: Decimal.Value, places: number): string {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/**
 * The figure shown to users and compared in every fixture: the stored
 * 6-decimal-place value (DEC-07), rounded half-up to 3 places at
 * presentation only. Never derive a displayed figure any other way --
 * academic standing (below) is explicitly compared against this value,
 * not the full-precision one, so this function is the single source of
 * "what the student sees."
 */
export function formatGpa(sixDpValue: string | null): string | null {
  return sixDpValue === null ? null : roundHalfUp(sixDpValue, 3);
}

// ---------------------------------------------------------------------------
// Score -> letter derivation (Section 16.3)
// ---------------------------------------------------------------------------

export interface GradeScaleEntry {
  letter: string;
  minScore: number | null;
  maxScore: number | null;
  gradePoint: string | null;
  countsInGpa: boolean;
  countsInAttempted: boolean;
  countsInEarned: boolean;
}

export class OutOfRangeScoreError extends Error {}

/**
 * Rounds the entered score to a whole number, half-up, exactly once, and
 * selects the letter whose band contains it. The rounded value is used
 * only for this lookup and is never itself stored (16.10: "round the
 * score more than once" is explicitly prohibited). The scale must be
 * ordered by displayOrder ascending, highest band first is not assumed --
 * this function checks every banded entry (min/max both set) and picks
 * the one containing the rounded score.
 */
export function deriveLetterFromScore(
  score: number,
  scale: GradeScaleEntry[],
): { letter: string; gradePoint: string | null } {
  if (score < 0 || score > 100) {
    throw new OutOfRangeScoreError(`Score ${score} is out of range (0-100).`);
  }
  const rounded = Number(roundHalfUp(score, 0));
  const entry = scale.find(
    (e) => e.minScore !== null && e.maxScore !== null && rounded >= e.minScore && rounded <= e.maxScore,
  );
  if (!entry) {
    throw new OutOfRangeScoreError(`No grade-scale band contains rounded score ${rounded}.`);
  }
  return { letter: entry.letter, gradePoint: entry.gradePoint };
}

// ---------------------------------------------------------------------------
// Repeat resolution (Section 16.5's "REPEAT RESOLUTION")
// ---------------------------------------------------------------------------

/**
 * Computed, never stored by hand: for every group of records sharing a
 * course, the one in the latest semester (by academic year, then
 * sequence) is kept; every other is dropped from CGPA and displayed with
 * the "R" marker. Ties are structurally impossible -- the database's own
 * unique constraint on (student, semester, course, attempt) guarantees at
 * most one record per course per semester.
 *
 * Only records where `countsInGpa` is true participate -- an Incomplete
 * has no grade point and never enters repeat resolution.
 *
 * Returns a map of record id -> isRepeatDropped, covering every
 * GPA-eligible record passed in.
 */
export function resolveRepeats(records: EngineRecord[]): Map<string, boolean> {
  const eligible = records.filter((r) => r.countsInGpa);
  const groups = new Map<string, EngineRecord[]>();
  for (const r of eligible) {
    const group = groups.get(r.courseCodeKey);
    if (group) group.push(r);
    else groups.set(r.courseCodeKey, [r]);
  }

  const result = new Map<string, boolean>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.set(group[0].id, false);
      continue;
    }
    const sorted = [...group].sort((a, b) => compareSortKey(b.semesterSortKey, a.semesterSortKey));
    result.set(sorted[0].id, false); // most recent -- kept
    for (let i = 1; i < sorted.length; i++) result.set(sorted[i].id, true); // dropped, displayed with "R"
  }
  return result;
}

// ---------------------------------------------------------------------------
// Semester GPA (Section 16.5's "SEMESTER GPA")
// ---------------------------------------------------------------------------

export interface SemesterSummaryResult {
  /** Full precision, stored at 6 decimal places; null when there are no eligible credits. */
  gpa: string | null;
  creditsAttempted: string;
  creditsEarned: string;
}

/**
 * A semester GPA is a historical fact about that term and does not change
 * years later because of something that happened afterwards (16.4.4) --
 * so this includes every GPA-eligible record in the semester, INCLUDING
 * one later dropped from CGPA by a repeat elsewhere. `records` must
 * already be scoped to one student and one semester.
 */
export function computeSemesterSummary(records: EngineRecord[]): SemesterSummaryResult {
  const eligible = records.filter((r) => r.countsInGpa);

  let qualityPoints = new Decimal(0);
  let creditsAttempted = new Decimal(0);
  let creditsEarned = new Decimal(0);

  for (const r of eligible) {
    const credits = new Decimal(r.creditHours);
    if (r.gradePoint !== null) {
      qualityPoints = qualityPoints.plus(new Decimal(r.gradePoint).times(credits));
    }
    if (r.countsInAttempted) creditsAttempted = creditsAttempted.plus(credits);
    if (r.countsInEarned) creditsEarned = creditsEarned.plus(credits);
  }

  const gpa = creditsAttempted.isZero() ? null : roundHalfUp(qualityPoints.dividedBy(creditsAttempted), 6);

  return {
    gpa,
    creditsAttempted: roundHalfUp(creditsAttempted, 1),
    creditsEarned: roundHalfUp(creditsEarned, 1),
  };
}

// ---------------------------------------------------------------------------
// Cumulative GPA (Section 16.5's "CUMULATIVE GPA")
// ---------------------------------------------------------------------------

export interface CumulativeSummaryResult {
  cgpa: string | null;
  totalCreditsAttempted: string;
  totalCreditsEarned: string;
}

/**
 * "TWO DENOMINATORS, DELIBERATELY DIFFERENT" (Section 16.5): total credits
 * attempted is computed over every GPA-eligible record; the CGPA
 * numerator/denominator and credits earned are computed over kept
 * (non-repeat-dropped) records only. `records` must already be scoped to
 * one student, across every semester. `isRepeatDropped` must come from
 * `resolveRepeats` run over these same records, not a possibly-stale
 * stored flag -- repeat resolution is recomputed, never trusted from
 * storage.
 */
export function computeCumulativeSummary(
  records: EngineRecord[],
  isRepeatDropped: Map<string, boolean>,
): CumulativeSummaryResult {
  const eligible = records.filter((r) => r.countsInGpa);

  let totalCreditsAttempted = new Decimal(0);
  for (const r of eligible) {
    if (r.countsInAttempted) totalCreditsAttempted = totalCreditsAttempted.plus(new Decimal(r.creditHours));
  }

  const kept = eligible.filter((r) => !isRepeatDropped.get(r.id));

  let qualityPoints = new Decimal(0);
  let keptCreditsAttempted = new Decimal(0);
  let totalCreditsEarned = new Decimal(0);
  for (const r of kept) {
    const credits = new Decimal(r.creditHours);
    if (r.gradePoint !== null) qualityPoints = qualityPoints.plus(new Decimal(r.gradePoint).times(credits));
    if (r.countsInAttempted) keptCreditsAttempted = keptCreditsAttempted.plus(credits);
    if (r.countsInEarned) totalCreditsEarned = totalCreditsEarned.plus(credits);
  }

  const cgpa = keptCreditsAttempted.isZero() ? null : roundHalfUp(qualityPoints.dividedBy(keptCreditsAttempted), 6);

  return {
    cgpa,
    totalCreditsAttempted: roundHalfUp(totalCreditsAttempted, 1),
    totalCreditsEarned: roundHalfUp(totalCreditsEarned, 1),
  };
}

export function creditsToGraduation(totalCreditsEarned: string, policy: GpaPolicy): string {
  const remaining = new Decimal(policy.graduationCreditHours).minus(new Decimal(totalCreditsEarned));
  return remaining.isNegative() ? "0.0" : roundHalfUp(remaining, 1);
}

// ---------------------------------------------------------------------------
// Mandatory repeat obligations (Section 16.4.2/16.5)
// ---------------------------------------------------------------------------

export interface RepeatObligation {
  recordId: string;
  courseCodeKey: string;
  reason: "F" | "D_MAJOR";
}

/**
 * Evaluated only over the KEPT attempt of each course, not the whole
 * history (fixture F-23: a retake that is itself a D in a major course
 * creates its own fresh obligation; the engine never looks past the kept
 * row). F always requires a repeat; D+/D- requires one only in the
 * student's own department at the time the result was recorded
 * (`wasMajorAtRecord`, frozen -- a later department change neither
 * creates nor clears an obligation, fixture F-24).
 */
export function deriveMandatoryRepeatObligations(
  records: EngineRecord[],
  isRepeatDropped: Map<string, boolean>,
): RepeatObligation[] {
  const kept = records.filter((r) => r.countsInGpa && !isRepeatDropped.get(r.id));
  const obligations: RepeatObligation[] = [];
  for (const r of kept) {
    if (r.letter === "F") {
      obligations.push({ recordId: r.id, courseCodeKey: r.courseCodeKey, reason: "F" });
    } else if ((r.letter === "D+" || r.letter === "D-") && r.wasMajorAtRecord) {
      obligations.push({ recordId: r.id, courseCodeKey: r.courseCodeKey, reason: "D_MAJOR" });
    }
  }
  return obligations;
}

// ---------------------------------------------------------------------------
// Academic standing (Section 16.7)
// ---------------------------------------------------------------------------

export type AcademicStanding = "HONOURS" | "GOOD_STANDING" | "PROBATION" | null;

/**
 * Derived at read time from the DISPLAYED (3-decimal-place) CGPA, never
 * the full-precision stored value (fixture F-43: a full-precision CGPA of
 * 1.99962 displays as "2.000" and must read as Good standing, not
 * Probation -- the label must never contradict the number beside it).
 * Suppressed entirely -- not "Unknown", not a blank cell -- whenever the
 * CGPA is null or provisional (F-44b/F-44c).
 */
export function deriveAcademicStanding(
  displayedCgpa: string | null,
  isProvisional: boolean,
  policy: GpaPolicy,
): AcademicStanding {
  if (displayedCgpa === null || isProvisional) return null;
  const cgpa = new Decimal(displayedCgpa);
  if (cgpa.gte(new Decimal(policy.standingHonoursAt))) return "HONOURS";
  if (cgpa.gte(new Decimal(policy.standingProbationBelow))) return "GOOD_STANDING";
  return "PROBATION";
}
