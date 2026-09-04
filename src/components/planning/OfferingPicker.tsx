import Link from "next/link";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { SubmitTextButton } from "@/components/ui/SubmitButton";

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

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface PickerOffering {
  id: string;
  courseId: string;
  section: string;
  frozenCreditHours: number;
  instructorName: string | null;
}

export interface PickerMeeting {
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
    <Card>
      <CardHeader>
        <CardTitle>Available offerings</CardTitle>
      </CardHeader>
      <CardBody>
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
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
              defaultValue={q ?? ""}
              placeholder="Code, title or instructor"
              className="w-72"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {q && (
            <Link href={clearSearchHref} className="pb-2 text-sm text-fg-muted hover:underline">
              Clear
            </Link>
          )}
        </form>

        <p className="mb-3 text-xs text-fg-muted">
          {totalMatching === 0
            ? q
              ? `No offerings match "${q}".`
              : "No offerings are available for this semester yet."
            : `Showing ${firstShown}–${lastShown} of ${totalMatching} offering${totalMatching === 1 ? "" : "s"}${
                q ? ` matching "${q}"` : ""
              }${q && totalAvailable !== totalMatching ? ` (${totalAvailable} in total)` : ""}.`}
        </p>

        <div className="flex flex-col gap-3">
          {offerings.map((o) => {
            const c = courseById.get(o.courseId);
            const meetings = meetingsByOffering.get(o.id) ?? [];
            const already = plannedOfferingIds.has(o.id);
            return (
              <div key={o.id} className="rounded-md border border-line p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-medium text-fg">
                    {c ? `${c.code} — ${c.title}` : o.courseId} (Section {o.section})
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">{o.frozenCreditHours}cr</span>
                </div>
                <p className="mb-2 text-xs text-fg-muted">
                  {meetings
                    .map((m) => `${DAY_NAMES[m.dayOfWeek]} ${m.startTime}-${m.endTime}${m.room ? ` (${m.room})` : ""}`)
                    .join(", ")}
                  {o.instructorName ? ` — ${o.instructorName}` : ""}
                </p>
                {already ? (
                  <span className="text-xs text-fg-subtle">Already in this plan</span>
                ) : (
                  <form action={addAction}>
                    {Object.entries(addHiddenFields).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <input type="hidden" name="offeringId" value={o.id} />
                    <SubmitTextButton disabled={disabled} pendingLabel="Adding…" className="text-xs font-medium text-brand-fg hover:underline">
                      Add
                    </SubmitTextButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} className="mt-4" label="Offerings pagination" />
      </CardBody>
    </Card>
  );
}
