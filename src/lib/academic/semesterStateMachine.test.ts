import { describe, expect, it } from "vitest";
import { SEMESTER_STATES, findTransitionRule, isStudentVisible, type SemesterState } from "./semesterStateMachine";

const LEGAL_PAIRS = new Set([
  "DRAFT>OPEN",
  "OPEN>REGISTRATION",
  "REGISTRATION>IN_PROGRESS",
  "IN_PROGRESS>GRADE_SUBMISSION",
  "GRADE_SUBMISSION>CLOSED",
  "OPEN>DRAFT",
  "REGISTRATION>OPEN",
  "IN_PROGRESS>REGISTRATION",
  "GRADE_SUBMISSION>IN_PROGRESS",
  "CLOSED>GRADE_SUBMISSION",
]);

describe("semester state machine (Section 13.2) — exhaustive over all 30 ordered pairs", () => {
  const pairs: Array<[SemesterState, SemesterState]> = [];
  for (const from of SEMESTER_STATES) {
    for (const to of SEMESTER_STATES) {
      if (from !== to) pairs.push([from, to]);
    }
  }

  it("covers exactly 30 non-identity ordered pairs", () => {
    expect(pairs).toHaveLength(30);
  });

  it.each(pairs)("%s -> %s", (from, to) => {
    const rule = findTransitionRule(from, to);
    const key = `${from}>${to}`;
    if (LEGAL_PAIRS.has(key)) {
      expect(rule).toBeDefined();
    } else {
      expect(rule).toBeUndefined();
    }
  });

  it("every forward transition is Admin-only with no reason required", () => {
    const forward = [
      ["DRAFT", "OPEN"],
      ["OPEN", "REGISTRATION"],
      ["REGISTRATION", "IN_PROGRESS"],
      ["IN_PROGRESS", "GRADE_SUBMISSION"],
      ["GRADE_SUBMISSION", "CLOSED"],
    ] as const;
    for (const [from, to] of forward) {
      const rule = findTransitionRule(from, to);
      expect(rule?.actorRole).toBe("ADMIN");
      expect(rule?.reasonRequired).toBe(false);
    }
  });

  it("every backward/reopen transition is Super-Admin-only and requires a reason", () => {
    const backward = [
      ["OPEN", "DRAFT"],
      ["REGISTRATION", "OPEN"],
      ["IN_PROGRESS", "REGISTRATION"],
      ["GRADE_SUBMISSION", "IN_PROGRESS"],
      ["CLOSED", "GRADE_SUBMISSION"],
    ] as const;
    for (const [from, to] of backward) {
      const rule = findTransitionRule(from, to);
      expect(rule?.actorRole).toBe("SUPER_ADMIN");
      expect(rule?.reasonRequired).toBe(true);
    }
  });
});

describe("isStudentVisible", () => {
  it("is false only for DRAFT", () => {
    expect(isStudentVisible("DRAFT")).toBe(false);
    for (const state of SEMESTER_STATES) {
      if (state !== "DRAFT") expect(isStudentVisible(state)).toBe(true);
    }
  });
});
