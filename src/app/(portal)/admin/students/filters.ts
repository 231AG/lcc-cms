import { STUDENT_STATUSES, type StudentStatus } from "@/lib/students/students";

/**
 * The Students listing's filter state, parsed once.
 *
 * Three routes now read the same query string -- the listing itself, the CSV
 * download and the print view -- and "the export respects the current
 * filters" is only true if all three interpret them identically. Parsing in
 * one place is what makes that a fact rather than a hope: an invalid status
 * or a malformed year is dropped here, so no route can be stricter or looser
 * than another.
 */

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface StudentListParams {
  q?: string;
  status?: string;
  collegeId?: string;
  year?: string;
  page?: string;
  pageSize?: string;
}

export interface StudentFilters {
  query?: string;
  status?: StudentStatus;
  collegeId?: string;
  enrolmentYear?: number;
  page: number;
  pageSize: number;
  /** True when anything at all is narrowing the list. */
  hasFilters: boolean;
}

export function parseStudentFilters(params: StudentListParams): StudentFilters {
  const status =
    params.status && (STUDENT_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as StudentStatus)
      : undefined;
  const enrolmentYear = params.year && /^\d{4}$/.test(params.year) ? Number(params.year) : undefined;
  const pageSize = PAGE_SIZES.includes(Number(params.pageSize) as (typeof PAGE_SIZES)[number])
    ? Number(params.pageSize)
    : DEFAULT_PAGE_SIZE;
  const query = params.q?.trim() || undefined;
  const collegeId = params.collegeId || undefined;

  return {
    query,
    status,
    collegeId,
    enrolmentYear,
    page: Math.max(1, Number(params.page) || 1),
    pageSize,
    hasFilters: Boolean(query || status || collegeId || enrolmentYear),
  };
}

/**
 * The filter part of the query string, without page or page size. Used to
 * point the CSV and print links at exactly what is on screen -- paging is
 * deliberately dropped, because both of those act on the whole filtered set,
 * not the page you happen to be looking at.
 */
export function filterSearchParams(filters: StudentFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.query) sp.set("q", filters.query);
  if (filters.status) sp.set("status", filters.status);
  if (filters.collegeId) sp.set("collegeId", filters.collegeId);
  if (filters.enrolmentYear) sp.set("year", String(filters.enrolmentYear));
  return sp;
}

/** A human sentence describing what is being shown, printed on the PDF so a
 *  page handed to somebody says what it is a list of. */
export function describeFilters(filters: StudentFilters, collegeName?: string): string {
  const parts: string[] = [];
  if (filters.query) parts.push(`matching “${filters.query}”`);
  if (filters.status) parts.push(`status ${filters.status}`);
  if (collegeName) parts.push(collegeName);
  if (filters.enrolmentYear) parts.push(`enrolled ${filters.enrolmentYear}`);
  return parts.length ? `Filtered: ${parts.join(" · ")}` : "All enrolled students";
}
