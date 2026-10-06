import { describe, expect, it } from "vitest";
import { titleCase } from "../titleCase";

describe("titleCase", () => {
  it("raises the first letter of every word", () => {
    expect(titleCase("criminal justice")).toBe("Criminal Justice");
    expect(titleCase("sinkor, monrovia")).toBe("Sinkor, Monrovia");
  });

  it("leaves the rest of each word as typed", () => {
    expect(titleCase("LCC annex")).toBe("LCC Annex");
    expect(titleCase("rev. mcGee")).toBe("Rev. McGee");
  });

  it("keeps joining words lower case unless they come first", () => {
    expect(titleCase("international business and management")).toBe("International Business and Management");
    expect(titleCase("the william v.s. tubman high school")).toBe("The William V.s. Tubman High School");
  });

  it("treats a hyphenated name as two words", () => {
    expect(titleCase("wleh-kpanbaye")).toBe("Wleh-Kpanbaye");
  });

  it("returns an empty value unchanged", () => {
    expect(titleCase("")).toBe("");
  });
});
