"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";

/**
 * The Students table.
 *
 * This is the one client component on the page, and only because the
 * header checkbox needs three states: checked, unchecked, and
 * indeterminate (some but not all rows selected). `indeterminate` is a DOM
 * property with no HTML attribute, so it cannot be server-rendered.
 * Everything else here -- the rows, the links, the badges -- is plain
 * markup over data the server already fetched and passed as JSON.
 *
 * No bulk action exists in the app yet, so the checkboxes deliberately do
 * nothing beyond track a selection (the count is announced for screen
 * readers so the control is not silently inert). When a bulk action is
 * added, `selected` is what it consumes.
 */

export interface StudentRow {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  status: string;
  /** Already formatted as "CODE — Name" by the page. */
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

/** Initials only. The student model stores no photo and this pass does not add one. */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function StudentsTable({ students, canEdit }: { students: StudentRow[]; canEdit: boolean }) {
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLInputElement>(null);

  // Derived, not reset in an effect: a page or filter change replaces the
  // rows, and any id no longer on screen must drop out of the selection --
  // otherwise the header checkbox reports a count the user cannot see.
  // Intersecting during render does that with no extra state or re-render.
  const onPage = new Set(students.map((s) => s.id));
  const selected = new Set([...rawSelected].filter((id) => onPage.has(id)));

  const allSelected = students.length > 0 && selected.size === students.length;
  const someSelected = selected.size > 0 && !allSelected;

  // `indeterminate` is a DOM property with no HTML attribute, so it cannot
  // be expressed in JSX and has to be set imperatively. This is the whole
  // reason this component runs on the client.
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(students.map((s) => s.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const checkboxClass =
    "h-4 w-4 cursor-pointer rounded border-line-strong accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

  return (
    <>
      <Table>
        <Thead>
          <tr>
            {/* Selection is hidden on the narrowest screens along with the
                avatar: no bulk action exists to use it yet, and those two
                columns are what push Actions off a 390px screen. Student
                ID, Name, Status and Actions stay visible at every width. */}
            <Th className="hidden w-10 sm:table-cell">
              <input
                ref={headerRef}
                type="checkbox"
                className={checkboxClass}
                checked={allSelected}
                onChange={toggleAll}
                disabled={students.length === 0}
                aria-label={allSelected ? "Deselect all students on this page" : "Select all students on this page"}
              />
            </Th>
            <Th className="px-2 sm:px-3">Student ID</Th>
            <Th className="px-2 sm:px-3">Name</Th>
            <Th className="px-2 sm:px-3">Status</Th>
            {/* College and Enrolment year are the two that drop first on
                a narrow screen -- Student ID, Name, Status and Actions stay
                visible at every width. */}
            <Th className="hidden md:table-cell">College</Th>
            <Th className="hidden sm:table-cell">Enrolment year</Th>
            <Th className="px-2 text-right sm:px-3">Actions</Th>
          </tr>
        </Thead>
        <tbody>
          {students.map((s) => (
            <Tr key={s.id} className={selected.has(s.id) ? "bg-brand-subtle" : undefined}>
              <Td className="hidden sm:table-cell">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={selected.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                  aria-label={`Select ${s.firstName} ${s.lastName}`}
                />
              </Td>
              <Td className="px-2 font-mono text-xs whitespace-nowrap text-fg-secondary sm:px-3">{s.studentNumber}</Td>
              <Td className="px-2 sm:px-3">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle-strong text-[11px] font-semibold text-brand-fg sm:flex"
                  >
                    {initials(s.firstName, s.lastName)}
                  </span>
                  <span className="font-medium text-fg">
                    {s.lastName}, {s.firstName}
                  </span>
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
                    title={`View ${s.firstName} ${s.lastName}`}
                    aria-label={`View ${s.firstName} ${s.lastName}`}
                    className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  {canEdit && (
                    <Link
                      href={`/admin/students/${s.id}`}
                      title={`Edit ${s.firstName} ${s.lastName}`}
                      aria-label={`Edit ${s.firstName} ${s.lastName}`}
                      className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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

      <p role="status" aria-live="polite" className="sr-only">
        {selected.size === 0 ? "No students selected" : `${selected.size} student${selected.size === 1 ? "" : "s"} selected`}
      </p>
    </>
  );
}
