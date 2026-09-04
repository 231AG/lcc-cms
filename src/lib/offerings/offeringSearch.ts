/**
 * Pure filtering/paging helpers for a list of course offerings, shared by
 * the Admin offerings page (A-08) and the student-facing course planning
 * picker (S-07). No I/O -- the caller has already fetched the semester's
 * offerings; this only decides which of them a given page shows, so both
 * pages behave identically for the same query without either owning the
 * logic.
 */

export interface SearchableOffering {
  id: string;
  courseId: string;
  section: string;
  instructorName: string | null;
}

export interface SearchableCourse {
  id: string;
  code: string;
  title: string;
}

/** Matches a course's code or title, the instructor's name, or the section
 * label -- the same four fields the Admin offerings search already used. */
export function filterOfferings<T extends SearchableOffering>(
  offerings: T[],
  courses: SearchableCourse[],
  q?: string,
): T[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return offerings;

  const courseById = new Map(courses.map((c) => [c.id, c]));
  return offerings.filter((o) => {
    const c = courseById.get(o.courseId);
    return (
      c?.code.toLowerCase().includes(needle) ||
      c?.title.toLowerCase().includes(needle) ||
      o.instructorName?.toLowerCase().includes(needle) ||
      o.section.toLowerCase().includes(needle)
    );
  });
}

/** Clamps `page` into range and returns that page's slice. Paging is done
 * here rather than in SQL because the caller already holds the semester's
 * full offering list for its course lookups; what matters for performance
 * is that only the returned slice's meeting times get fetched. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  return {
    rows: rows.slice((clamped - 1) * pageSize, clamped * pageSize),
    page: clamped,
    totalPages,
  };
}
