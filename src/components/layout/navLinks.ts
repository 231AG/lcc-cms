import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  Download,
  FilePen,
  GraduationCap,
  History,
  Network,
  Scale,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import type { Role } from "@/lib/permissions/kernel";

export interface NavLink {
  href: string;
  label: string;
  /** Sidebar glyph. Additive: the label is still the accessible name, and
   * the icon is decorative, so nothing depends on it being right. */
  icon: LucideIcon;
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
      { href: "/admin/offerings", label: "Course offerings", icon: BookOpen },
      { href: "/planning", label: "Course planning", icon: ClipboardList },
      { href: "/grading-policy", label: "Grading policy", icon: Scale },
    ],
  },
];

export const ADMIN_GROUPS: NavGroup[] = [
  {
    label: "Students",
    links: [
      { href: "/admin/students", label: "Student Listing", icon: Users },
      { href: "/admin/historical/progress", label: "Historical import progress", icon: History },
    ],
  },
  {
    label: "Academic",
    links: [
      { href: "/admin/structure", label: "Academic structure", icon: Network },
      { href: "/admin/calendar", label: "Academic calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Planning",
    links: [
      { href: "/admin/offerings", label: "Course offerings", icon: BookOpen },
      // Ordered as the work actually flows: publish the offerings, enter a
      // plan for a student who can't (DEV-20), review what comes in,
      // register directly only as the exception path.
      { href: "/admin/student-plan", label: "Course plan entry", icon: ClipboardPen },
      { href: "/admin/planning", label: "Course plan review", icon: ClipboardCheck },
      { href: "/admin/registrations", label: "Registrations", icon: UserCheck },
    ],
  },
  {
    label: "Grades",
    links: [
      { href: "/admin/grades", label: "Class grade entry", icon: GraduationCap },
      { href: "/admin/grade-corrections", label: "Grade corrections", icon: FilePen },
      { href: "/admin/export", label: "Semester export", icon: Download },
      { href: "/grading-policy", label: "Grading policy", icon: Scale },
    ],
  },
];

export const SUPER_ADMIN_GROUPS: NavGroup[] = [
  {
    label: "Accounts",
    links: [
      { href: "/admin/accounts", label: "Admin accounts", icon: ShieldCheck },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  {
    label: "Students",
    links: [
      { href: "/admin/students", label: "Student Listing", icon: Users },
      { href: "/admin/historical/progress", label: "Historical import progress", icon: History },
    ],
  },
  {
    label: "Academic",
    links: [
      { href: "/admin/calendar", label: "Academic calendar", icon: CalendarDays },
      { href: "/admin/offerings", label: "Course offerings", icon: BookOpen },
    ],
  },
  {
    label: "Grades",
    links: [
      { href: "/admin/grade-review", label: "Grade submission review", icon: CheckCheck },
      { href: "/admin/grade-corrections", label: "Grade corrections", icon: FilePen },
      { href: "/admin/export", label: "Semester export", icon: Download },
      { href: "/grading-policy", label: "Grading policy", icon: Scale },
    ],
  },
];

export function navGroupsForRole(role: Role): NavGroup[] {
  if (role === "SUPER_ADMIN") return SUPER_ADMIN_GROUPS;
  if (role === "ADMIN") return ADMIN_GROUPS;
  return STUDENT_GROUPS;
}
