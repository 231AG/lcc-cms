import { describe, expect, it } from "vitest";
import { levelCreditRange, levelForCredits } from "../level";

describe("levelForCredits", () => {
  it("follows the College's cut-offs on earned credit hours", () => {
    expect(levelForCredits(0)).toBe("FRESHMAN");
    expect(levelForCredits("32.5")).toBe("FRESHMAN");
    expect(levelForCredits(33)).toBe("SOPHOMORE");
    expect(levelForCredits("65.0")).toBe("SOPHOMORE");
    expect(levelForCredits(66)).toBe("JUNIOR");
    expect(levelForCredits(98)).toBe("JUNIOR");
    expect(levelForCredits(99)).toBe("SENIOR");
    expect(levelForCredits(140)).toBe("SENIOR");
  });

  it("makes a student with no record yet a Freshman", () => {
    expect(levelForCredits(null)).toBe("FRESHMAN");
    expect(levelForCredits(undefined)).toBe("FRESHMAN");
  });

  it("gives each level the range the next one starts after", () => {
    expect(levelCreditRange("FRESHMAN")).toEqual({ min: 0, below: 33 });
    expect(levelCreditRange("JUNIOR")).toEqual({ min: 66, below: 99 });
    expect(levelCreditRange("SENIOR")).toEqual({ min: 99, below: null });
  });
});
