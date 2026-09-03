import { describe, it, expect } from "vitest";
import { filterOfferings, pageSlice, type SearchableCourse, type SearchableOffering } from "./offeringSearch";
import { pageWindow } from "@/components/ui/Pagination";

const courses: SearchableCourse[] = [
  { id: "c1", code: "ACCT 301", title: "Cost Accounting II" },
  { id: "c2", code: "PATH 403", title: "Global Ministry" },
  { id: "c3", code: "SOCI 101", title: "Introduction to Sociology" },
];

const offerings: SearchableOffering[] = [
  { id: "o1", courseId: "c1", section: "A", instructorName: "J. Kollie" },
  { id: "o2", courseId: "c2", section: "B", instructorName: null },
  { id: "o3", courseId: "c3", section: "A", instructorName: "M. Tarpeh" },
];

describe("filterOfferings", () => {
  it("returns everything when there is no query", () => {
    expect(filterOfferings(offerings, courses)).toHaveLength(3);
    expect(filterOfferings(offerings, courses, "   ")).toHaveLength(3);
  });

  it("matches a course code case-insensitively", () => {
    expect(filterOfferings(offerings, courses, "acct").map((o) => o.id)).toEqual(["o1"]);
  });

  it("matches a course title", () => {
    expect(filterOfferings(offerings, courses, "ministry").map((o) => o.id)).toEqual(["o2"]);
  });

  it("matches an instructor name, and tolerates a null one", () => {
    expect(filterOfferings(offerings, courses, "tarpeh").map((o) => o.id)).toEqual(["o3"]);
  });

  it("matches a section label", () => {
    expect(filterOfferings(offerings, courses, "b").map((o) => o.id)).toEqual(["o2"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterOfferings(offerings, courses, "zzzz")).toEqual([]);
  });

  it("does not match an offering whose course is missing from the course list", () => {
    const orphan: SearchableOffering = { id: "o4", courseId: "missing", section: "C", instructorName: null };
    expect(filterOfferings([orphan], courses, "acct")).toEqual([]);
  });
});

describe("pageSlice", () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1);

  it("slices the requested page", () => {
    expect(pageSlice(rows, 2, 20)).toMatchObject({ page: 2, totalPages: 3 });
    expect(pageSlice(rows, 2, 20).rows).toEqual(rows.slice(20, 40));
  });

  it("clamps a page below the first one", () => {
    expect(pageSlice(rows, 0, 20).page).toBe(1);
    expect(pageSlice(rows, -5, 20).page).toBe(1);
  });

  it("clamps a page past the last one, so a stale link never shows an empty list", () => {
    const result = pageSlice(rows, 99, 20);
    expect(result.page).toBe(3);
    expect(result.rows).toEqual(rows.slice(40));
  });

  it("reports one page for an empty list", () => {
    expect(pageSlice([], 1, 20)).toEqual({ rows: [], page: 1, totalPages: 1 });
  });
});

describe("pageWindow", () => {
  it("lists every page when the range is short", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("inserts a gap on both sides for a long range", () => {
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  });

  it("renders a single skipped page rather than an ellipsis for it", () => {
    // 1 … 3 4 5 would be no shorter than 1 2 3 4 5 and reads worse.
    expect(pageWindow(4, 9)).toEqual([1, 2, 3, 4, 5, null, 9]);
  });

  it("handles the first and last pages without a leading/trailing gap", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
  });

  it("returns a single page for an empty or one-page list", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});
