import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { fullName, initials, listName } from "@/lib/students/name";

/**
 * The Students table.
 *
 * This used to be the one client component on the page, purely so the header
 * checkbox could be set `indeterminate` (a DOM property with no HTML
 * attribute). The selection checkboxes are gone -- there is no bulk view or
 * edit in this app and none is planned, so they were a control that looked
 * actionable and did nothing -- and with them went the only reason this file
 * needed to run on the client. It is now a plain Server Component: no state,
 * no effects, and nothing shipped to the browser.
 */

export interface StudentRow {
  id: string;
  studentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  status: string;
  /** The college's name on its own -- the page resolves it. */
  collegeName: string;
  enrolmentYear: number;
}

/**
 * Semantic colour per status, over the app's existing Badge tones and only
 * the five statuses STUDENT_STATUSES actually defines. There is no
 * "pending" status in this system; ADMISSION_FORFEITED is the one that
 * reads as a warning.
 */
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "danger",
  GRADUATED: "info",
  ADMISSION_FORFEITED: "warning",
};

/** Every icon control carries the same treatment: a tooltip on hover, and an
 *  accessible name that says the same thing for anyone not using a mouse. */
const iconAction =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function StudentsTable({ students, canEdit }: { students: StudentRow[]; canEdit: boolean }) {
  return (
    <Table>
      <Thead>
        <tr>
          <Th className="px-2 sm:px-3">Student ID</Th>
          <Th className="px-2 sm:px-3">Name</Th>
          <Th className="px-2 sm:px-3">Status</Th>
          {/* College and Enrolment year are the two that drop first on a
              narrow screen -- Student ID, Name, Status and Actions stay
              visible at every width. */}
          <Th className="hidden md:table-cell">College</Th>
          <Th className="hidden sm:table-cell">Enrolment year</Th>
          <Th className="px-2 text-right sm:px-3">Actions</Th>
        </tr>
      </Thead>
      <tbody>
        {students.map((s) => (
          <Tr key={s.id}>
            <Td className="px-2 font-mono text-xs whitespace-nowrap text-fg-secondary sm:px-3">{s.studentNumber}</Td>
            <Td className="px-2 sm:px-3">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle-strong text-[11px] font-semibold text-brand-fg sm:flex"
                >
                  {initials(s)}
                </span>
                <span className="font-medium text-fg">{listName(s)}</span>
              </span>
            </Td>
            <Td className="px-2 sm:px-3">
              <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{s.status}</Badge>
            </Td>
            {/* Truncated with the full value on hover/focus rather than
                widening the table -- some college names are long. */}
            <Td className="hidden md:table-cell">
              <span className="block max-w-[18rem] truncate text-fg-secondary" title={s.collegeName}>
                {s.collegeName}
              </span>
            </Td>
            <Td className="hidden sm:table-cell text-fg-secondary">{s.enrolmentYear}</Td>
            <Td className="px-2 sm:px-3">
              <span className="flex items-center justify-end gap-1">
                <Link
                  href={`/admin/students/${s.id}?mode=view`}
                  title={`View ${fullName(s)}`}
                  aria-label={`View ${fullName(s)}`}
                  className={iconAction}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                </Link>
                {canEdit && (
                  <Link
                    href={`/admin/students/${s.id}`}
                    title={`Edit ${fullName(s)}`}
                    aria-label={`Edit ${fullName(s)}`}
                    className={iconAction}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </span>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
