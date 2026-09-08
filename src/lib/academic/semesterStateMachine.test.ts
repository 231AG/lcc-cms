import { describe, expect, it } from "vitest";
import {
  SEMESTER_STATES,
  findTransitionRule,
  isDeletable,
  isGradeEntryOpen,
  isOfferingEditable,
  isPlanningOpen,
  isSealed,
  isStudentVisible,
  legalNextStatesForRole,
  reasonRequiredFor,
  type SemesterState,
} from "./semesterStateMachine";

const LEGAL_PAIRS = new Set(["DRAFT>OPEN", "OPEN>IN_PROGRESS", "IN_PROGRESS>CLOSED", "CLOSED>IN_PROGRESS"]);

describe("semester state machine — exhaustive over all 12 ordered pairs", () => {
  const pairs: Array<[SemesterState, SemesterState]> = [];
  for (const from of SEMESTER_STATES) {
    for (const to of SEMESTER_STATES) {
      if (from !== to) pairs.push([from, to]);
    }
  }

  it("covers exactly 12 non-identity ordered pairs", () => {
    expect(pairs).toHaveLength(12);
  });

  it.each(pairs)("%s -> %s", (from, to) => {
    const rule = findTransitionRule(from, to);
    if (LEGAL_PAIRS.has(`${from}>${to}`)) {
      expect(rule).toBeDefined();
    } else {
      expect(rule).toBeUndefined();
    }
  });

  it("has no backward transition other than the reopen", () => {
    // The lifecycle is forward-only. Every pair that walks back down the
    // order is illegal except CLOSED -> IN_PROGRESS, which is the one
    // deliberate exception and is marked as such on the rule itself.
    const order = SEMESTER_STATES.map((s) => s as string);
    for (const [from, to] of pairs) {
      const goesBackwards = order.indexOf(to) < order.indexOf(from);
      const rule = findTransitionRule(from, to);
      if (goesBackwards && rule) {
        expect(`${from}>${to}`).toBe("CLOSED>IN_PROGRESS");
        expect(rule.isReopen).toBe(true);
      }
    }
  });

  it("lets either staff role make an ordinary forward move", () => {
    for (const [from, to] of [
      ["DRAFT", "OPEN"],
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "CLOSED"],
    ] as const) {
      const rule = findTransitionRule(from, to);
      expect(rule?.actorRoles).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect(rule?.isReopen).toBe(false);
    }
  });

  it("restricts the reopen to a Super Admin and always demands a reason", () => {
    const rule = findTransitionRule("CLOSED", "IN_PROGRESS");
    expect(rule?.actorRoles).toEqual(["SUPER_ADMIN"]);
    expect(rule?.reasonAlwaysRequired).toBe(true);
    expect(reasonRequiredFor(rule!, "SUPER_ADMIN")).toBe(true);
    expect(reasonRequiredFor(rule!, "ADMIN")).toBe(true);
  });
});

describe("reasonRequiredFor", () => {
  it("requires a reason of an Admin and makes it optional for a Super Admin", () => {
    const forward = findTransitionRule("OPEN", "IN_PROGRESS")!;
    expect(reasonRequiredFor(forward, "ADMIN")).toBe(true);
    expect(reasonRequiredFor(forward, "SUPER_ADMIN")).toBe(false);
  });
});

describe("legalNextStatesForRole", () => {
  it("offers an Admin every forward move but never the reopen", () => {
    expect(legalNextStatesForRole("DRAFT", "ADMIN").map((r) => r.to)).toEqual(["OPEN"]);
    expect(legalNextStatesForRole("IN_PROGRESS", "ADMIN").map((r) => r.to)).toEqual(["CLOSED"]);
    expect(legalNextStatesForRole("CLOSED", "ADMIN")).toEqual([]);
  });

  it("offers a Super Admin the reopen out of CLOSED", () => {
    expect(legalNextStatesForRole("CLOSED", "SUPER_ADMIN").map((r) => r.to)).toEqual(["IN_PROGRESS"]);
  });

  it("offers a Student nothing anywhere", () => {
    for (const state of SEMESTER_STATES) {
      expect(legalNextStatesForRole(state, "STUDENT")).toEqual([]);
    }
  });
});

describe("capability-by-state", () => {
  // Each capability belongs to exactly one state, which is the whole point
  // of collapsing six states into four -- these are the four questions the
  // extra two states used to answer.
  it("shows the semester to students in every state but Draft", () => {
    expect(isStudentVisible("DRAFT")).toBe(false);
    for (const state of SEMESTER_STATES) {
      if (state !== "DRAFT") expect(isStudentVisible(state)).toBe(true);
    }
  });

  it("opens course planning only while Open (what REGISTRATION used to gate)", () => {
    expect(SEMESTER_STATES.filter(isPlanningOpen)).toEqual(["OPEN"]);
  });

  it("opens grade entry only while In Progress (what GRADE_SUBMISSION used to gate)", () => {
    expect(SEMESTER_STATES.filter(isGradeEntryOpen)).toEqual(["IN_PROGRESS"]);
  });

  it("allows offering edits before teaching starts, and not after", () => {
    expect(SEMESTER_STATES.filter(isOfferingEditable)).toEqual(["DRAFT", "OPEN"]);
  });

  it("seals only a Closed semester, and allows deletion only of a Draft", () => {
    expect(SEMESTER_STATES.filter(isSealed)).toEqual(["CLOSED"]);
    expect(SEMESTER_STATES.filter(isDeletable)).toEqual(["DRAFT"]);
  });
});
