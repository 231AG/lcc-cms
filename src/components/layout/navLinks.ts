import type { Role } from "@/lib/permissions/kernel";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * Single source of truth for role-based navigation, now used by both the
 * persistent header (src/components/layout/Header.tsx) and the student
 * portal home page's own inline links. Previously these lists (ADMIN_LINKS/
 * SUPER_ADMIN_LINKS) lived only in src/app/portal/page.tsx, the one place
 * that had ever needed them, because there was no persistent nav at all.
 */
export const STUDENT_LINKS: NavLink[] = [
  { href: "/planning", label: "Course planning" },
  { href: "/grading-policy", label: "Grading policy" },
];

export const ADMIN_LINKS: NavLink[] = [
  { href: "/admin/students", label: "Students" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/structure", label: "Academic structure" },
  { href: "/admin/calendar", label: "Academic calendar" },
  { href: "/admin/offerings", label: "Course offerings" },
  { href: "/admin/planning", label: "Course plan review" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/grades", label: "Class grade entry" },
  { href: "/admin/grade-corrections", label: "Grade corrections" },
  { href: "/admin/export", label: "Semester export" },
  { href: "/grading-policy", label: "Grading policy" },
];

export const SUPER_ADMIN_LINKS: NavLink[] = [
  { href: "/admin/accounts", label: "Admin accounts" },
  { href: "/admin/students", label: "Students (read-only)" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/calendar", label: "Academic calendar (read-only)" },
  { href: "/admin/offerings", label: "Course offerings (read-only)" },
  { href: "/admin/grade-review", label: "Grade submission review" },
  { href: "/admin/export", label: "Semester export" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/grading-policy", label: "Grading policy" },
  { href: "/admin/grade-corrections", label: "Grade corrections" },
];

export function navLinksForRole(role: Role): NavLink[] {
  if (role === "SUPER_ADMIN") return SUPER_ADMIN_LINKS;
  if (role === "ADMIN") return ADMIN_LINKS;
  return STUDENT_LINKS;
}
