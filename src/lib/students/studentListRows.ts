import { csvCell } from "@/lib/export/csvCell";
import { asUser } from "@/lib/db/asUser";
import { exportStudents } from "@/lib/students/students";
import { listName } from "@/lib/students/name";
import { genderLabel } from "@/lib/students/gender";
import { enrollmentLabel } from "@/lib/students/enrollment";
import { LEVEL_LABEL } from "@/lib/students/level";
import { getStudentLevels } from "@/lib/gpa/gpa";
import type { Actor } from "@/lib/permissions/kernel";
import type { SearchStudentsInput } from "@/lib/students/students";

/**
 * The Students listing as flat rows, exactly the columns the table shows.
 *
 * Shared by the CSV download and the print view so both produce the same
 * columns in the same order as the screen -- "all visible columns, all
 * matching rows" is one definition here, not three that drift apart.
 *
 * The college lookup is two small reads of reference data (tens of
 * departments, a handful of colleges) resolved in memory, rather than a
 * join per student: the same approach the listing page already takes, and
 * the same reason -- these tables are tiny and cached hot.
 */

/** Index signature so a row is directly usable by the generic CSV writer
 *  and the generic print table without a cast at every call site. */
export interface StudentListRow {
  [column: string]: string;
  studentNumber: string;
  name: string;
  gender: string;
  /** The level: Freshman ... Senior. */
  level: string;
  /** Enrollment: Active, Graduated ... */
  status: string;
  college: string;
  enrolmentYear: string;
}

/** `nowrap` marks the short columns, so only the free-text ones wrap when
 *  the table is printed. */
export const STUDENT_LIST_COLUMNS = [
  { key: "studentNumber", header: "Student ID", nowrap: true },
  { key: "name", header: "Name" },
  { key: "gender", header: "Gender", nowrap: true },
  { key: "level", header: "Status", nowrap: true },
  { key: "status", header: "Enrollment", nowrap: true },
  { key: "college", header: "College" },
  { key: "enrolmentYear", header: "Enrolment year", nowrap: true },
] as const satisfies ReadonlyArray<{ key: keyof StudentListRow; header: string; nowrap?: boolean }>;

/**
 * The printed listing drops Enrollment.
 *
 * A CSV is data -- you filter and pivot it, so more columns are strictly
 * better. A printed page is a document somebody reads across a room, and
 * whether each row is enrolled is not what a printed roll is for; leaving it
 * out buys the remaining columns the width they need in landscape. The
 * level (Status) stays: it is what a roll is often sorted by.
 */
export const STUDENT_PRINT_COLUMNS = STUDENT_LIST_COLUMNS.filter((c) => c.key !== "status");

export async function getStudentListRows(
  actor: Actor,
  filters: SearchStudentsInput,
): Promise<{ rows: StudentListRow[]; truncated: boolean; collegeName?: string }> {
  const [{ rows: students, truncated }, reference] = await Promise.all([
    exportStudents(actor, filters),
    asUser(actor.userId, (tx) =>
      Promise.all([tx.query.department.findMany(), tx.query.college.findMany()]),
    ),
  ]);
  const [departments, colleges] = reference;
  const levels = await getStudentLevels(actor, students.map((s) => s.id));

  // The college's name without its code, matching the on-screen listing.
  const collegeFor = (departmentId: string): string => {
    const department = departments.find((d) => d.id === departmentId);
    if (!department) return "";
    return colleges.find((c) => c.id === department.collegeId)?.name ?? "";
  };

  return {
    rows: students.map((s) => ({
      studentNumber: s.studentNumber,
      name: listName(s),
      // "—" for a student enrolled before gender was recorded, so the column
      // reads as "not recorded" rather than as an empty cell that looks like
      // a rendering fault.
      gender: genderLabel(s.gender),
      level: LEVEL_LABEL[levels.get(s.id) ?? "FRESHMAN"],
      status: enrollmentLabel(s.status),
      college: collegeFor(s.departmentId),
      enrolmentYear: String(s.enrolmentYear),
    })),
    truncated,
    collegeName: filters.collegeId ? colleges.find((c) => c.id === filters.collegeId)?.name : undefined,
  };
}

/** RFC 4180 quoting: double the quotes, wrap anything containing a comma,
 *  quote, or newline. Same rule the semester export already uses. */
export function toCsv(columns: ReadonlyArray<{ key: string; header: string }>, rows: Array<Record<string, string>>): string {
  // csvCell, not a local quoter: RFC 4180 quoting alone leaves a leading
  // "=" as a live spreadsheet formula. See lib/export/csvCell.ts.
  const escape = csvCell;
  const lines = [columns.map((c) => escape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c.key] ?? "")).join(","));
  }
  return lines.join("\r\n");
}
