import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { Label, Select } from "@/components/ui/Form";
import { buttonClasses } from "@/components/ui/Button";
import { SubmitTextButton } from "@/components/ui/SubmitButton";
import { trimCredits, type GradeSheetData } from "@/lib/gradesheet/gradeSheet";
import { computeIncompleteDeadlineSemester, formatSemesterSortKey } from "@/lib/gpa/incompleteDeadline";

/**
 * One semester's results, exactly as the student profile has shown them
 * since Stage 5 -- lifted out of that page so the dedicated Grades screen
 * can show the same table rather than a second, subtly different one.
 *
 * Presentational only, and a Server Component like everything around it:
 * the caller does the fetching and the permission check, which is what
 * keeps this reusable without it needing an Actor.
 */

export interface SemesterSortKey {
  yearStart: number;
  sequence: 1 | 2;
}

export interface SemesterOption {
  id: string;
  label: string;
}

/**
 * The Year / Semester pair. A plain GET form -- `data-auto-submit` loads
 * on change and the button is the no-JavaScript fallback, the same hook
 * the admin pickers use.
 *
 * The semester list is always narrowed to the chosen year by the caller,
 * so the two controls cannot be set to a combination with nothing behind
 * it.
 */
export function SemesterResultsPicker({
  years,
  semesters,
  selectedYearId,
  selectedSemesterId,
  hiddenFields,
}: {
  years: SemesterOption[];
  semesters: SemesterOption[];
  selectedYearId: string | undefined;
  selectedSemesterId: string | undefined;
  /** Query parameters the page needs kept across the submit -- a GET form
   *  replaces the whole query string, so anything not in it is dropped.
   *  The admin student page uses this to hold on to `?mode=view`. */
  hiddenFields?: Record<string, string>;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3 print:hidden sm:px-5">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <Label htmlFor="year" className="text-xs">
          Year
        </Label>
        <Select id="year" name="year" defaultValue={selectedYearId ?? ""} className="w-40 font-semibold" data-auto-submit="">
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="semesterId" className="text-xs">
          Semester
        </Label>
        <Select
          id="semesterId"
          name="semesterId"
          defaultValue={selectedSemesterId ?? ""}
          className="w-40 font-semibold"
          data-auto-submit=""
        >
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <SubmitTextButton className={buttonClasses("secondary", "md")} pendingLabel="Loading…">
        View
      </SubmitTextButton>
    </form>
  );
}

/**
 * The results themselves. `sortKey` is only used to work out an Incomplete
 * grade's resolution deadline, which is a function of the semester it was
 * earned in.
 */
export function SemesterResultsTable({
  sheet,
  label,
  sortKey,
  isProvisional,
}: {
  sheet: GradeSheetData;
  label: string;
  sortKey?: SemesterSortKey;
  isProvisional?: boolean;
}) {
  return (
    <>
      <h3 className="mb-2 text-sm font-semibold text-fg">{label}</h3>
      <Table>
        <Thead>
          <tr>
            <Th>Course Title</Th>
            <Th className="text-center">Code</Th>
            <Th className="text-center">Cr/Hrs</Th>
            <Th className="text-center">Grade</Th>
            <Th className="text-center">Grade Point</Th>
            <Th className="text-center">Grade Points</Th>
          </tr>
        </Thead>
        <tbody>
          {sheet.courses.length === 0 && (
            <Tr>
              <Td colSpan={6} className="text-center text-fg-muted">
                No results are recorded for this semester.
              </Td>
            </Tr>
          )}
          {sheet.courses.map((c, i) => (
            <Tr key={`${c.code}-${i}`} className={i % 2 === 1 ? "bg-brand-subtle" : undefined}>
              <Td>
                {c.title}
                {c.isRepeatDropped && " (R)"}
                {c.letter === "I" && sortKey && (
                  <span className="ml-1 text-xs text-warning-fg">
                    — must be resolved by end of {formatSemesterSortKey(computeIncompleteDeadlineSemester(sortKey))}
                  </span>
                )}
              </Td>
              <Td className="text-center whitespace-nowrap">{c.code}</Td>
              <Td className="text-center">{c.creditHours}</Td>
              <Td className="text-center">{c.letter}</Td>
              <Td className="text-center">{c.gradePoint ?? "—"}</Td>
              <Td className="text-center">{c.gradePoints ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
        {/* The semester's own figures belong under the rows they are drawn
            from, which is also where the printed sheet puts them. No fill:
            the purple band is the heading's job, and a second one at the
            foot competes with it. What separates the totals from the
            results is a rule twice the weight of the ones between rows --
            a line the eye reads as "below this is a different kind of
            number". CGPA stays in the Academic record card: it is
            cumulative and says nothing about this table. */}
        <tfoot className="text-fg">
          <tr>
            <td colSpan={5} className="border-t-2 border-brand-fg px-3 py-2 text-right font-bold">
              Total Credit Earned
            </td>
            <td className="border-t-2 border-brand-fg px-3 py-2 text-right font-bold">
              {trimCredits(sheet.summary.creditsEarned)} Cr/Hrs
            </td>
          </tr>
          <tr>
            <td colSpan={5} className="px-3 py-2 text-right font-bold">
              Total Grade Points
            </td>
            <td className="px-3 py-2 text-right font-bold">{sheet.summary.totalGradePoints}</td>
          </tr>
          <tr>
            <td colSpan={5} className="px-3 py-2 text-right font-bold">
              Semester GPA
              {isProvisional && <span className="ml-1 text-xs font-normal text-fg-muted">(provisional)</span>}
            </td>
            <td className="px-3 py-2 text-right font-bold">{sheet.summary.gpa ?? "—"}</td>
          </tr>
        </tfoot>
      </Table>
    </>
  );
}
