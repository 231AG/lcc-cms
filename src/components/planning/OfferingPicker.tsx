import Link from "next/link";
import { TableCard } from "@/components/ui/TableCard";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Label, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { SubmitButton, SubmitTextButton } from "@/components/ui/SubmitButton";
import { formatMeetingSlots } from "@/lib/offerings/offeringRows";

/**
 * The "available offerings" picker used both by a student building their
 * own plan (S-07, /planning) and by an Admin building one on a student's
 * behalf (/admin/student-plan). One component so the two screens cannot
 * drift apart -- the Admin path is deliberately the same UI over the same
 * data, differing only in which hidden fields its forms carry.
 *
 * Takes an ALREADY filtered-and-paged list plus meeting times for exactly
 * that page. Fetching meeting times for the whole semester (177 offerings
 * in the real 2026/2027 schedule) one offering at a time is what made this
 * list unusable before -- see getOfferingMeetingsForOfferings.
 */


export interface PickerOffering {
  id: string;
  courseId: string;
  section: string;
  frozenCreditHours: number;
  instructorName: string | null;
}

export interface PickerMeeting {
  /** Carried so the shared slot formatter can group these the same way
   *  the offerings listing does. */
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string | null;
}

export interface PickerCourse {
  id: string;
  code: string;
  title: string;
}

export function OfferingPicker({
  offerings,
  courses,
  meetingsByOffering,
  plannedOfferingIds,
  q,
  page,
  pageSize,
  totalMatching,
  totalAvailable,
  hrefForPage,
  clearSearchHref,
  searchHiddenFields,
  addAction,
  addHiddenFields,
  disabled = false,
}: {
  offerings: PickerOffering[];
  courses: PickerCourse[];
  meetingsByOffering: Map<string, PickerMeeting[]>;
  plannedOfferingIds: Set<string>;
  q?: string;
  page: number;
  pageSize: number;
  totalMatching: number;
  totalAvailable: number;
  hrefForPage: (page: number) => string;
  clearSearchHref: string;
  searchHiddenFields: Record<string, string>;
  addAction: (formData: FormData) => Promise<void>;
  addHiddenFields: Record<string, string>;
  disabled?: boolean;
}) {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const firstShown = totalMatching === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, totalMatching);

  return (
    <>
      <TableCard
        title="Available offerings"
        count={totalMatching}
        countLabel="offering"
        filters={
          <form method="GET" className="flex flex-wrap items-end gap-2">
            {Object.entries(searchHiddenFields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <div>
              <Label htmlFor="offering-search" className="text-xs">
                Search offerings
              </Label>
              <Input
                id="offering-search"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="Code, title or instructor"
                className="sm:w-72"
              />
            </div>
            <SubmitButton variant="secondary">Search</SubmitButton>
            {q && (
              <Link href={clearSearchHref} className="text-fg-muted pb-2 text-sm hover:underline">
                Clear
              </Link>
            )}
          </form>
        }
      >
        <Table>
          <Thead>
            <tr>
              <Th className="whitespace-nowrap">Course Code</Th>
              <Th>Course Title</Th>
              <Th className="whitespace-nowrap">Sec</Th>
              <Th className="hidden whitespace-nowrap sm:table-cell">Cr/Hrs</Th>
              <Th className="whitespace-nowrap">Day &amp; Time</Th>
              <Th className="hidden whitespace-nowrap lg:table-cell">Instructor</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </Thead>
          <tbody>
            {offerings.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-fg-muted px-4 py-8 text-center text-sm">
                  {q ? `No offerings match “${q}”.` : "No offerings are available for this semester yet."}
                </td>
              </tr>
            ) : (
              offerings.map((o) => {
                const c = courseById.get(o.courseId);
                const meetings = meetingsByOffering.get(o.id) ?? [];
                const already = plannedOfferingIds.has(o.id);
                // "MWF 11:00-12:00 - PAPE 1" rather than the same class
                // written out once per weekday with the seconds nobody
                // schedules to. Same helper the plan table and the Course
                // offerings listing use, so one course reads the same way
                // wherever it appears.
                const slots = formatMeetingSlots(meetings);
                return (
                  <Tr key={o.id} className="align-top">
                    <Td className="text-fg-secondary font-mono text-xs whitespace-nowrap">{c?.code ?? o.courseId}</Td>
                    <Td className="text-fg min-w-[12rem] font-medium">
                      {c?.title ?? "—"}
                      {/* The columns dropped on a narrow screen reappear
                          under the title rather than vanishing: on a phone
                          this list is how somebody picks a class, and the
                          credits are half the decision. */}
                      <span className="text-fg-muted mt-0.5 block text-xs sm:hidden">
                        {o.frozenCreditHours} Cr/Hrs
                        {o.instructorName ? ` · ${o.instructorName}` : ""}
                      </span>
                      <span className="text-fg-muted mt-0.5 hidden text-xs sm:block lg:hidden">
                        {o.instructorName ?? ""}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{o.section}</Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{o.frozenCreditHours}</Td>
                    <Td className="text-fg-secondary text-xs">
                      {slots.length === 0 ? <span className="text-fg-muted">Not scheduled</span> : slots.join(", ")}
                    </Td>
                    <Td className="hidden lg:table-cell">{o.instructorName ?? "—"}</Td>
                    <Td className="text-right whitespace-nowrap">
                      {already ? (
                        <span className="text-fg-muted text-xs">Already in this plan</span>
                      ) : (
                        <form action={addAction}>
                          {Object.entries(addHiddenFields).map(([name, value]) => (
                            <input key={name} type="hidden" name={name} value={value} />
                          ))}
                          <input type="hidden" name="offeringId" value={o.id} />
                          <SubmitTextButton
                            disabled={disabled}
                            pendingLabel="Adding…"
                            className="text-brand-fg text-xs font-medium hover:underline"
                          >
                            Add
                          </SubmitTextButton>
                        </form>
                      )}
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
      </TableCard>

      <p className="text-fg-muted mt-2 text-xs">
        {totalMatching === 0
          ? ""
          : `Showing ${firstShown}–${lastShown} of ${totalMatching} offering${totalMatching === 1 ? "" : "s"}${
              q ? ` matching “${q}”` : ""
            }${q && totalAvailable !== totalMatching ? ` (${totalAvailable} in total)` : ""}.`}
      </p>

      <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} className="mt-4" label="Offerings pagination" />
    </>
  );
}
