import type { Role } from "@/lib/permissions/kernel";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * A labeled group renders as a dropdown menu; a group with an empty label
 * renders its links inline instead (Student's two links don't need a menu
 * to hide behind).
 */
export interface NavGroup {
  label: string;
  links: NavLink[];
}

/**
 * Single source of truth for role-based navigation, used by the
 * persistent header (src/components/layout/Header.tsx). Same routes,
 * same items, same permissions per role as before this grouping pass
 * (DEV-## nav modernization) -- only the visual organization changed,
 * confirmed with the project owner before building it this way.
 */
export const STUDENT_GROUPS: NavGroup[] = [
  {
    label: "",
    links: [
      { href: "/planning", label: "Course planning" },
      { href: "/grading-policy", label: "Grading policy" },
    ],
  },
];

export const ADMIN_GROUPS: NavGroup[] = [
  {
    label: "Students",
    links: [
      { href: "/admin/students", label: "Students" },
      { href: "/admin/historical/progress", label: "Historical import progress" },
    ],
  },
  {
    label: "Academic",
    links: [
      { href: "/admin/structure", label: "Academic structure" },
      { href: "/admin/calendar", label: "Academic calendar" },
    ],
  },
  {
    label: "Planning",
    links: [
      { href: "/admin/offerings", label: "Course offerings" },
      // Ordered as the work actually flows: publish the offerings, enter a
      // plan for a student who can't (DEV-20), review what comes in,
      // register directly only as the exception path.
      { href: "/admin/student-plan", label: "Course plan entry" },
      { href: "/admin/planning", label: "Course plan review" },
      { href: "/admin/registrations", label: "Registrations" },
    ],
  },
  {
    label: "Grades",
    links: [
      { href: "/admin/grades", label: "Class grade entry" },
      { href: "/admin/grade-corrections", label: "Grade corrections" },
      { href: "/admin/export", label: "Semester export" },
      { href: "/grading-policy", label: "Grading policy" },
    ],
  },
];

export const SUPER_ADMIN_GROUPS: NavGroup[] = [
  {
    label: "Accounts",
    links: [
      { href: "/admin/accounts", label: "Admin accounts" },
      { href: "/admin/audit", label: "Audit log" },
    ],
  },
  {
    label: "Students",
    links: [
      { href: "/admin/students", label: "Students (read-only)" },
      { href: "/admin/historical/progress", label: "Historical import progress" },
    ],
  },
  {
    label: "Academic",
    links: [
      { href: "/admin/calendar", label: "Academic calendar (read-only)" },
      { href: "/admin/offerings", label: "Course offerings (read-only)" },
    ],
  },
  {
    label: "Grades",
    links: [
      { href: "/admin/grade-review", label: "Grade submission review" },
      { href: "/admin/grade-corrections", label: "Grade corrections" },
      { href: "/admin/export", label: "Semester export" },
      { href: "/grading-policy", label: "Grading policy" },
    ],
  },
];

export function navGroupsForRole(role: Role): NavGroup[] {
  if (role === "SUPER_ADMIN") return SUPER_ADMIN_GROUPS;
  if (role === "ADMIN") return ADMIN_GROUPS;
  return STUDENT_GROUPS;
}
