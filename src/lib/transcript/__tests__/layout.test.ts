import { describe, expect, it } from "vitest";
import { BOX_LINE_MM, FIRST_PAGE_TOP_MM, layoutTranscript, type LayoutYear } from "../layout";

const year = (...semesters: number[]): LayoutYear => ({ semesters });
const yearsOf = (pages: ReturnType<typeof layoutTranscript>) => pages.map((p) => p.columns.map((c) => c.map(([y]) => y)));

describe("layoutTranscript", () => {
  it("puts a short record and its summary on one page", () => {
    const pages = layoutTranscript([year(5, 5), year(4)]);
    expect(pages).toEqual([
      {
        columns: [
          [
            [0, 0],
            [0, 1],
          ],
          [[1, 0]],
        ],
        closing: true,
      },
    ]);
  });

  it("gives one academic year per column and two years per page", () => {
    const pages = layoutTranscript([year(6, 6), year(5, 5), year(5, 5), year(4, 3)]);
    expect(yearsOf(pages)).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 3],
      ],
    ]);
    expect(pages.map((p) => p.closing)).toEqual([false, true]);
  });

  it("ends a ten-semester record on a third page, summary included", () => {
    const pages = layoutTranscript([year(6, 6), year(5, 5), year(5, 5), year(5, 4), year(3, 2)]);
    expect(pages).toHaveLength(3);
    expect(pages[2]).toEqual({
      columns: [
        [
          [4, 0],
          [4, 1],
        ],
      ],
      closing: true,
    });
  });

  it("moves the summary to its own page when it would not fit under the tables", () => {
    const pages = layoutTranscript([year(8, 8), year(8, 8)]);
    expect(pages).toHaveLength(2);
    expect(pages[0].closing).toBe(false);
    expect(pages[1]).toEqual({ columns: [], closing: true });
  });

  it("allows for information boxes that wrap onto extra lines", () => {
    // Fits under plain boxes; four wrapped lines push the summary over.
    expect(layoutTranscript([year(5, 5), year(5)])).toHaveLength(1);
    expect(layoutTranscript([year(5, 5), year(5)], FIRST_PAGE_TOP_MM + 4 * BOX_LINE_MM)).toHaveLength(2);
  });

  it("carries a year too long for one column into the next column", () => {
    const pages = layoutTranscript([year(14, 14)]);
    expect(pages[0].columns).toEqual([[[0, 0]], [[0, 1]]]);
  });

  it("still prints the information boxes and summary for a record with no results", () => {
    expect(layoutTranscript([])).toEqual([{ columns: [], closing: true }]);
  });
});
