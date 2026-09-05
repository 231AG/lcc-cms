import { asUser } from "@/lib/db/asUser";
import { exportStudents } from "@/lib/students/students";
import { listName } from "@/lib/students/name";
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
  status: string;
  college: string;
  enrolmentYear: string;
}

/** `nowrap` marks the short columns, so only the free-text ones wrap when
 *  the table is printed. */
export const STUDENT_LIST_COLUMNS = [
  { key: "studentNumber", header: "Student ID", nowrap: true },
  { key: "name", header: "Name" },
  { key: "status", header: "Status", nowrap: true },
  { key: "college", header: "College" },
  { key: "enrolmentYear", header: "Enrolment year", nowrap: true },
] as const satisfies ReadonlyArray<{ key: keyof StudentListRow; header: string; nowrap?: boolean }>;

/**
 * The printed listing drops Status.
 *
 * A CSV is data -- you filter and pivot it, so more columns are strictly
 * better. A printed page is a document somebody reads across a room, and the
 * enrolment status of every row is not what a printed roll is for; leaving it
 * out buys the four remaining columns the width they need in landscape.
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
      status: s.status,
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
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [columns.map((c) => escape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c.key] ?? "")).join(","));
  }
  return lines.join("\r\n");
}
