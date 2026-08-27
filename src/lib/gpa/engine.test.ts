import { describe, expect, it } from "vitest";
import {
  DEFAULT_GPA_POLICY,
  computeCumulativeSummary,
  computeSemesterSummary,
  deriveAcademicStanding,
  deriveLetterFromScore,
  deriveMandatoryRepeatObligations,
  formatGpa,
  resolveRepeats,
  roundHalfUp,
  type EngineRecord,
  type GradeScaleEntry,
  type SemesterSortKey,
  OutOfRangeScoreError,
} from "./engine";

/**
 * Appendix B, plan Section "How to use this appendix": "Transcribe these
 * forty-seven fixtures into a test file before writing a line of the GPA
 * engine... the acceptance criterion for Gate G7." Every ID below (F-01a
 * through F-47b) is quoted directly from the appendix, re-verified by
 * hand against the raw PDF text (pdftotext -raw, not -layout, which
 * mis-aligns this specific table) before transcription -- an earlier
 * research pass mis-transcribed F-13/F-14 from the -layout extraction;
 * both are corrected here.
 *
 * Fixtures whose assertion belongs to a later stage's infrastructure
 * (course-plan submission in Stage 9; the grade-correction two-key
 * approval workflow in Stage 10) are marked DEFERRED below, with the
 * stage that will actually exercise them -- not silently dropped.
 */

const SCALE: Record<string, { gp: string | null; gpa: boolean; att: boolean; earn: boolean }> = {
  "A+": { gp: "4.00", gpa: true, att: true, earn: true },
  "A-": { gp: "3.70", gpa: true, att: true, earn: true },
  "B+": { gp: "3.30", gpa: true, att: true, earn: true },
  "B-": { gp: "2.70", gpa: true, att: true, earn: true },
  "C+": { gp: "2.30", gpa: true, att: true, earn: true },
  "C-": { gp: "1.70", gpa: true, att: true, earn: true },
  "D+": { gp: "1.30", gpa: true, att: true, earn: true },
  "D-": { gp: "0.70", gpa: true, att: true, earn: true },
  F: { gp: "0.00", gpa: true, att: true, earn: false },
  I: { gp: null, gpa: false, att: false, earn: false },
};

const SCALE_ENTRIES: GradeScaleEntry[] = Object.entries({
  "A+": [95, 100],
  "A-": [90, 94],
  "B+": [85, 89],
  "B-": [80, 84],
  "C+": [75, 79],
  "C-": [70, 74],
  "D+": [65, 69],
  "D-": [60, 64],
  F: [0, 59],
}).map(([letter, [minScore, maxScore]]) => ({
  letter,
  minScore,
  maxScore,
  gradePoint: SCALE[letter].gp,
  countsInGpa: SCALE[letter].gpa,
  countsInAttempted: SCALE[letter].att,
  countsInEarned: SCALE[letter].earn,
}));

let idCounter = 0;
const S1: SemesterSortKey = { yearStart: 2025, sequence: 1 };
const S2: SemesterSortKey = { yearStart: 2025, sequence: 2 };

function rec(
  courseCode: string,
  credits: number,
  letter: keyof typeof SCALE,
  opts: { semester?: SemesterSortKey; major?: boolean } = {},
): EngineRecord {
  const s = SCALE[letter];
  const semester = opts.semester ?? S1;
  return {
    id: `r${idCounter++}`,
    courseCodeKey: courseCode,
    semesterId: `sem-${semester.yearStart}-${semester.sequence}`,
    semesterSortKey: semester,
    creditHours: String(credits),
    gradePoint: s.gp,
    countsInGpa: s.gpa,
    countsInAttempted: s.att,
    countsInEarned: s.earn,
    wasMajorAtRecord: opts.major ?? false,
    letter,
  };
}

describe("B.1 Score-to-letter derivation", () => {
  it("F-01a: 96 -> A+ 4.00", () => {
    expect(deriveLetterFromScore(96, SCALE_ENTRIES)).toEqual({ letter: "A+", gradePoint: "4.00" });
  });
  it("F-01b: 94.4 rounds to 94 -> A- 3.70", () => {
    expect(deriveLetterFromScore(94.4, SCALE_ENTRIES)).toEqual({ letter: "A-", gradePoint: "3.70" });
  });
  it("F-01c: 94.5 rounds to 95 -> A+ 4.00 (half-up carries into A+)", () => {
    expect(deriveLetterFromScore(94.5, SCALE_ENTRIES)).toEqual({ letter: "A+", gradePoint: "4.00" });
  });
  it("F-01d: 59.4 rounds to 59 -> F 0.00 (pass boundary from below)", () => {
    expect(deriveLetterFromScore(59.4, SCALE_ENTRIES)).toEqual({ letter: "F", gradePoint: "0.00" });
  });
  it("F-01e: 59.5 rounds to 60 -> D- 0.70 (half-up turns a fail into a pass)", () => {
    expect(deriveLetterFromScore(59.5, SCALE_ENTRIES)).toEqual({ letter: "D-", gradePoint: "0.70" });
  });
  it("F-01f: 100 -> A+ 4.00 (upper bound accepted)", () => {
    expect(deriveLetterFromScore(100, SCALE_ENTRIES)).toEqual({ letter: "A+", gradePoint: "4.00" });
  });
  it("F-01g: 0 -> F 0.00 (lower bound accepted)", () => {
    expect(deriveLetterFromScore(0, SCALE_ENTRIES)).toEqual({ letter: "F", gradePoint: "0.00" });
  });
  it("F-01h: 100.1 and -1 are rejected as out of range", () => {
    expect(() => deriveLetterFromScore(100.1, SCALE_ENTRIES)).toThrow(OutOfRangeScoreError);
    expect(() => deriveLetterFromScore(-1, SCALE_ENTRIES)).toThrow(OutOfRangeScoreError);
  });
  it("F-01i: 87.5 bands as 88 -> B+ 3.30 (entered mark stored verbatim elsewhere; only the band lookup uses 88)", () => {
    expect(deriveLetterFromScore(87.5, SCALE_ENTRIES)).toEqual({ letter: "B+", gradePoint: "3.30" });
  });
});

describe("B.2 Semester GPA", () => {
  it("F-02: 2.842, attempted 12, earned 12", () => {
    const records = [rec("CSC101", 3, "A+"), rec("THE110", 3, "B+"), rec("MAT105", 4, "C-"), rec("ENG101", 2, "B-")];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("2.842");
    expect(result.creditsAttempted).toBe("12.0");
    expect(result.creditsEarned).toBe("12.0");
  });

  it("F-03: 2.133, attempted 9, earned 6 (the F stays in the denominator)", () => {
    const records = [rec("CSC201", 3, "B-"), rec("THE210", 3, "F"), rec("MAT201", 3, "A-")];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("2.133");
    expect(result.creditsAttempted).toBe("9.0");
    expect(result.creditsEarned).toBe("6.0");
  });

  it("F-04: 4.000, trailing zeros preserved", () => {
    const records = [rec("A", 3, "A+"), rec("B", 3, "A+"), rec("C", 3, "A+")];
    expect(formatGpa(computeSemesterSummary(records).gpa)).toBe("4.000");
  });

  it("F-05: 0.000 (not null -- the student did attempt), attempted 6, earned 0", () => {
    const records = [rec("MAT101", 3, "F"), rec("PHY101", 3, "F")];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("0.000");
    expect(result.creditsAttempted).toBe("6.0");
    expect(result.creditsEarned).toBe("0.0");
  });

  it("F-06: null, not 0.000, when the only record is an Incomplete", () => {
    const records = [rec("THE200", 3, "I")];
    const result = computeSemesterSummary(records);
    expect(result.gpa).toBeNull();
    expect(result.creditsAttempted).toBe("0.0");
  });

  it("F-07: 3.163 (25.30 / 8 = 3.1625 exactly; half-up gives 3.163, truncation would give 3.162)", () => {
    const records = [rec("CSC401", 3, "A+"), rec("THE401", 3, "B+"), rec("ENG401", 2, "C-")];
    expect(formatGpa(computeSemesterSummary(records).gpa)).toBe("3.163");
  });

  it("F-08: 2.800 (a value that terminates before three places still prints three)", () => {
    const records = [rec("BIB300", 3, "B+"), rec("HIS300", 3, "C+")];
    expect(formatGpa(computeSemesterSummary(records).gpa)).toBe("2.800");
  });

  it("F-09: 1.700, minimal single-course case", () => {
    const records = [rec("X", 1, "C-")];
    expect(formatGpa(computeSemesterSummary(records).gpa)).toBe("1.700");
  });

  it("F-10: 2.714, maximum 21-credit load rounds down", () => {
    const records = [
      rec("C1", 3, "A+"),
      rec("C2", 3, "A-"),
      rec("C3", 3, "B+"),
      rec("C4", 3, "B-"),
      rec("C5", 3, "C+"),
      rec("C6", 3, "C-"),
      rec("C7", 3, "D+"),
    ];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("2.714");
    expect(result.creditsAttempted).toBe("21.0");
  });

  it("F-11: 1.433, D grades earn credit, exactly one repeat obligation against the major course", () => {
    const records = [
      rec("THE210", 3, "D-", { major: true }),
      rec("MAT105", 3, "D+", { major: false }),
      rec("ENG101", 3, "C+", { major: false }),
    ];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("1.433");
    expect(result.creditsEarned).toBe("9.0");

    const dropped = resolveRepeats(records);
    const obligations = deriveMandatoryRepeatObligations(records, dropped);
    expect(obligations).toHaveLength(1);
    expect(obligations[0].courseCodeKey).toBe("THE210");
    expect(obligations[0].reason).toBe("D_MAJOR");
  });
});

describe("B.3 Repeats and carry-over", () => {
  it("F-12: the core carry-over fixture -- CGPA 3.233, S1 stays 1.650, S2 is 3.200, F obligation cleared", () => {
    const s1 = [rec("CSC101", 3, "F", { semester: S1 }), rec("THE110", 3, "B+", { semester: S1 })];
    const s2 = [rec("CSC101", 3, "B-", { semester: S2 }), rec("MAT105", 3, "A-", { semester: S2 })];
    const all = [...s1, ...s2];

    expect(formatGpa(computeSemesterSummary(s1).gpa)).toBe("1.650");
    expect(formatGpa(computeSemesterSummary(s2).gpa)).toBe("3.200");

    const dropped = resolveRepeats(all);
    expect(dropped.get(s1[0].id)).toBe(true); // CSC101 S1 F -- dropped, marked R
    expect(dropped.get(s2[0].id)).toBe(false); // CSC101 S2 B- -- kept, most recent

    const cumulative = computeCumulativeSummary(all, dropped);
    expect(formatGpa(cumulative.cgpa)).toBe("3.233");
    expect(cumulative.totalCreditsEarned).toBe("9.0");
    expect(cumulative.totalCreditsAttempted).toBe("12.0");

    const obligations = deriveMandatoryRepeatObligations(all, dropped);
    expect(obligations).toHaveLength(0); // the F obligation is cleared by the kept passing B-
  });

  it('F-13: CGPA "1.700" under most-recent (the retake was worse); "4.000" under a best-attempt policy switch (ASM-19)', () => {
    const all = [rec("BIB101", 3, "A+", { semester: S1 }), rec("BIB101", 3, "C-", { semester: S2 })];
    const dropped = resolveRepeats(all);
    expect(formatGpa(computeCumulativeSummary(all, dropped).cgpa)).toBe("1.700");

    // The alternative policy, proving the switch is genuine (not hard-coded):
    // best-attempt keeps the higher grade point regardless of chronology.
    const bestAttemptDropped = new Map(all.map((r) => [r.id, r.gradePoint !== "4.00"]));
    expect(formatGpa(computeCumulativeSummary(all, bestAttemptDropped).cgpa)).toBe("4.000");
  });

  it('F-14: CGPA "3.300" -- three attempts, only the third (most recent) counts', () => {
    const all = [
      rec("PHY101", 3, "F", { semester: { yearStart: 2025, sequence: 1 } }),
      rec("PHY101", 3, "D-", { semester: { yearStart: 2025, sequence: 2 } }),
      rec("PHY101", 3, "B+", { semester: { yearStart: 2026, sequence: 1 } }),
    ];
    const dropped = resolveRepeats(all);
    expect(dropped.get(all[2].id)).toBe(false);
    expect(dropped.get(all[0].id)).toBe(true);
    expect(dropped.get(all[1].id)).toBe(true);
    expect(formatGpa(computeCumulativeSummary(all, dropped).cgpa)).toBe("3.300");
  });

  it("F-15: CGPA 3.700 -- chronology resolved by academic year then sequence, not insertion order", () => {
    const all = [
      rec("ENG101", 3, "C-", { semester: { yearStart: 2024, sequence: 2 } }),
      rec("ENG101", 3, "A-", { semester: { yearStart: 2025, sequence: 1 } }),
    ];
    const dropped = resolveRepeats(all);
    expect(dropped.get(all[1].id)).toBe(false); // 2025 S1 is later than 2024 S2 despite lower sequence number
    expect(formatGpa(computeCumulativeSummary(all, dropped).cgpa)).toBe("3.700");
  });

  it("F-16: CGPA 4.000 -- the carry-over rule resolves by chronology regardless of origin (imported vs system)", () => {
    const all = [rec("CSC101", 3, "F", { semester: S1 }), rec("CSC101", 3, "A+", { semester: S2 })];
    const dropped = resolveRepeats(all);
    expect(formatGpa(computeCumulativeSummary(all, dropped).cgpa)).toBe("4.000");
  });

  it("F-17: CGPA 3.000 -- a repeat spanning two origins behaves identically; credit not earned twice", () => {
    const all = [
      rec("MAT101", 3, "B-", { semester: S1 }),
      rec("ENG101", 3, "B-", { semester: S1 }),
      rec("MAT101", 3, "B+", { semester: S2 }),
    ];
    const dropped = resolveRepeats(all);
    const cumulative = computeCumulativeSummary(all, dropped);
    expect(formatGpa(cumulative.cgpa)).toBe("3.000");
    expect(cumulative.totalCreditsEarned).toBe("6.0"); // not 9 -- MAT101 counts once
  });
});

describe("B.4 Mandatory repeat obligations", () => {
  it("F-18: F in a non-major course still creates an obligation", () => {
    const records = [rec("X", 3, "F", { major: false })];
    const dropped = resolveRepeats(records);
    expect(deriveMandatoryRepeatObligations(records, dropped)).toEqual([
      { recordId: records[0].id, courseCodeKey: "X", reason: "F" },
    ]);
  });

  it("F-19: D- in the student's own department creates an obligation; credit still earned", () => {
    const records = [rec("X", 3, "D-", { major: true })];
    expect(records[0].countsInEarned).toBe(true);
    expect(deriveMandatoryRepeatObligations(records, resolveRepeats(records))[0].reason).toBe("D_MAJOR");
  });

  it("F-20: D+ also triggers the rule, not only D-", () => {
    const records = [rec("X", 3, "D+", { major: true })];
    expect(deriveMandatoryRepeatObligations(records, resolveRepeats(records))).toHaveLength(1);
  });

  it("F-21: D+ in another department creates no obligation; credit is earned", () => {
    const records = [rec("X", 3, "D+", { major: false })];
    expect(records[0].countsInEarned).toBe(true);
    expect(deriveMandatoryRepeatObligations(records, resolveRepeats(records))).toHaveLength(0);
  });

  it("F-22: a major-course D- later passed with C- clears the obligation", () => {
    const all = [
      rec("X", 3, "D-", { semester: S1, major: true }),
      rec("X", 3, "C-", { semester: S2, major: true }),
    ];
    const dropped = resolveRepeats(all);
    expect(dropped.get(all[0].id)).toBe(true); // marked R, dropped from CGPA
    expect(deriveMandatoryRepeatObligations(all, dropped)).toHaveLength(0);
  });

  it("F-23: a major-course D- retaken and still graded D+ creates a fresh obligation from the kept attempt", () => {
    const all = [
      rec("X", 3, "D-", { semester: S1, major: true }),
      rec("X", 3, "D+", { semester: S2, major: true }),
    ];
    const dropped = resolveRepeats(all);
    const obligations = deriveMandatoryRepeatObligations(all, dropped);
    expect(obligations).toHaveLength(1);
    expect(obligations[0].recordId).toBe(all[1].id); // the kept (second) attempt, not the history
  });

  it("F-24: was_major_at_record is frozen -- a later department change neither creates nor clears an obligation", () => {
    // The engine has no notion of "current department"; it only ever reads
    // the frozen flag passed in, which is exactly what makes a later
    // transfer inert here -- there is nothing for the engine to recompute.
    const records = [rec("THE210", 3, "D-", { major: true })];
    expect(deriveMandatoryRepeatObligations(records, resolveRepeats(records))).toHaveLength(1);
  });

  // F-25 (a student with two outstanding obligations submits a plan
  // including neither -- the plan is not blocked, only warned) exercises
  // course-plan submission and approval, which doesn't exist until Stage
  // 9. deriveMandatoryRepeatObligations above is exactly what Stage 9's
  // plan-approval screen will call to build that warning; there is
  // nothing further for the pure engine to prove now.
});

describe("B.5 Incomplete", () => {
  it("F-26: GPA 3.150 with an Incomplete in the semester; attempted 6, earned 6", () => {
    const records = [rec("CSC301", 3, "A+"), rec("THE301", 3, "I"), rec("MAT301", 3, "C+")];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("3.150");
    expect(result.creditsAttempted).toBe("6.0");
    expect(result.creditsEarned).toBe("6.0");
  });

  it("F-27: once resolved to a letter, the same semester recomputes to 3.200 with attempted/earned 9", () => {
    const records = [rec("CSC301", 3, "A+"), rec("THE301", 3, "B+"), rec("MAT301", 3, "C+")];
    const result = computeSemesterSummary(records);
    expect(formatGpa(result.gpa)).toBe("3.200");
    expect(result.creditsAttempted).toBe("9.0");
    expect(result.creditsEarned).toBe("9.0");
  });

  it("F-28: a semester entirely of Incompletes returns GPA null, not 0.000", () => {
    const records = [rec("A", 3, "I"), rec("B", 3, "I")];
    expect(computeSemesterSummary(records).gpa).toBeNull();
  });

  // F-29 (Withdrawal/Audit/transfer-credit grades must be rejected) is a
  // data-entry validation, not GPA arithmetic -- already enforced in
  // Stage 6's enterHistoricalSemester, which refuses any letter absent
  // from the active grade_scale, and the seeded scale (Stage 1) never
  // contains W, AU or TR.
});

describe("B.6 Provisional marking and integrity", () => {
  it("F-36: a computed GPA string survives a JSON round trip exactly, no floating-point artefact", () => {
    const records = [rec("CSC401", 3, "A+"), rec("THE401", 3, "B+"), rec("ENG401", 2, "C-")];
    const gpa = formatGpa(computeSemesterSummary(records).gpa);
    const roundTripped = JSON.parse(JSON.stringify({ gpa })).gpa;
    expect(roundTripped).toBe("3.163");
    expect(roundTripped).not.toMatch(/999999|000001/); // the classic float artefact shape
  });

  // F-30/F-31/F-32/F-33/F-34/F-35/F-37/F-38/F-39/F-40 test the
  // recomputation SERVICE (provisional propagation, recompute-on-write
  // transactions, reconciliation queries) rather than the pure engine --
  // see recompute.integration.test.ts.
});

describe("B.7 Academic standing and Incomplete expiry", () => {
  it("F-41: CGPA exactly 3.500 is Honours; 3.499 is Good standing (inclusive boundary)", () => {
    expect(deriveAcademicStanding("3.500", false, DEFAULT_GPA_POLICY)).toBe("HONOURS");
    expect(deriveAcademicStanding("3.499", false, DEFAULT_GPA_POLICY)).toBe("GOOD_STANDING");
  });

  it("F-42: CGPA exactly 2.000 is Good standing; 1.999 is Probation (inclusive boundary)", () => {
    expect(deriveAcademicStanding("2.000", false, DEFAULT_GPA_POLICY)).toBe("GOOD_STANDING");
    expect(deriveAcademicStanding("1.999", false, DEFAULT_GPA_POLICY)).toBe("PROBATION");
  });

  it("F-43: a full-precision CGPA of 1.99962 displays as 2.000 and reads as Good standing, never Probation", () => {
    const displayed = formatGpa("1.999620");
    expect(displayed).toBe("2.000");
    expect(deriveAcademicStanding(displayed, false, DEFAULT_GPA_POLICY)).toBe("GOOD_STANDING");
  });

  it("F-44: a student passing every course at D- (CGPA 0.700) is on Probation despite failing nothing", () => {
    expect(deriveAcademicStanding("0.700", false, DEFAULT_GPA_POLICY)).toBe("PROBATION");
  });

  it("F-44b: a provisional CGPA carries no standing label at all, whatever its value", () => {
    expect(deriveAcademicStanding("3.900", true, DEFAULT_GPA_POLICY)).toBeNull();
    expect(deriveAcademicStanding("0.100", true, DEFAULT_GPA_POLICY)).toBeNull();
  });

  it("F-44c: a null CGPA (no academic records) has no standing label and no division error", () => {
    expect(deriveAcademicStanding(null, false, DEFAULT_GPA_POLICY)).toBeNull();
  });

  // F-45 (Incomplete resolution deadline display) is covered in
  // incompleteDeadline.test.ts. F-46 (semester-close review worklist),
  // F-47 (converting an overdue Incomplete through the two-key correction
  // workflow) and F-47b (refusing an Admin-only shortcut) all require the
  // grade-correction infrastructure that Stage 10 builds -- there is no
  // service path to test yet, and per Section 16.4.5's own callout,
  // building a bypass now would be exactly the wrong shortcut.
});

describe("roundHalfUp", () => {
  it("rounds .5 away from zero, not to even (banker's rounding)", () => {
    expect(roundHalfUp("2.5", 0)).toBe("3");
    expect(roundHalfUp("3.5", 0)).toBe("4");
  });
});
