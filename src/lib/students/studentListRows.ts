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

export const STUDENT_LIST_COLUMNS = [
  { key: "studentNumber", header: "Student ID" },
  { key: "name", header: "Name" },
  { key: "status", header: "Status" },
  { key: "college", header: "College" },
  { key: "enrolmentYear", header: "Enrolment year" },
] as const satisfies ReadonlyArray<{ key: keyof StudentListRow; header: string }>;

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

  const collegeFor = (departmentId: string): string => {
    const department = departments.find((d) => d.id === departmentId);
    if (!department) return "";
    const college = colleges.find((c) => c.id === department.collegeId);
    return college ? `${college.code} — ${college.name}` : "";
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
    collegeName: filters.collegeId
      ? (() => {
          const college = colleges.find((c) => c.id === filters.collegeId);
          return college ? `${college.code} — ${college.name}` : undefined;
        })()
      : undefined,
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
