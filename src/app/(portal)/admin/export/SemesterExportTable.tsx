import { AlertTriangle, Download, Printer } from "lucide-react";
import type { ExportableSemester } from "@/lib/export/academicExport";
import { Card, CardBody } from "@/components/ui/Card";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";

const fileLink =
  "text-brand-fg hover:text-brand-fg-hover inline-flex items-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap hover:underline " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The Semester export page's content: one row per semester with what an
 * export of it would hold and its two files, then a short note on what
 * each file contains. Presentational -- the page loads the list and
 * checks the role.
 */
export function SemesterExportTable({ semesters }: { semesters: ExportableSemester[] }) {
  return (
    <>
      <Card className="mb-6 overflow-hidden">
        {semesters.length === 0 ? (
          <CardBody>
            <p className="text-fg-muted text-sm">No semesters exist yet.</p>
          </CardBody>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th className="text-left">Semester</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Grades recorded</Th>
                <Th className="text-left">Not yet published</Th>
                <Th className="text-left">Course grades</Th>
                <Th className="text-left">Semester results</Th>
              </tr>
            </Thead>
            <tbody>
              {semesters.map((s) => {
                const empty = s.recordCount === 0;
                return (
                  <Tr key={s.id}>
                    <Td className="text-fg font-semibold whitespace-nowrap">{s.label}</Td>
                    <Td>
                      <SemesterStateBadge state={s.state} />
                    </Td>
                    <Td className="text-right tabular-nums">{s.studentCount}</Td>
                    <Td className="text-right tabular-nums">{s.recordCount}</Td>
                    <Td>
                      {s.unpublishedCount > 0 ? (
                        <span className="text-warning-fg inline-flex items-start gap-1.5 text-sm">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            {s.unpublishedCount} {s.unpublishedCount === 1 ? "student has" : "students have"} no published grade
                          </span>
                        </span>
                      ) : (
                        <span className="text-fg-subtle text-sm">None</span>
                      )}
                    </Td>
                    {empty ? (
                      <Td colSpan={2} className="text-fg-muted text-sm">
                        Nothing recorded for this semester yet.
                      </Td>
                    ) : (
                      <>
                        <Td>
                          <a href={`/admin/export/${s.id}`} className={fileLink}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            CSV
                            <span className="sr-only"> of course grades, {s.label}</span>
                          </a>
                        </Td>
                        <Td>
                          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <a href={`/admin/export/${s.id}/results`} className={fileLink}>
                              <Download className="h-4 w-4" aria-hidden="true" />
                              CSV
                              <span className="sr-only"> of semester results, {s.label}</span>
                            </a>
                            <a href={`/admin/export/${s.id}/print`} className={fileLink}>
                              <Printer className="h-4 w-4" aria-hidden="true" />
                              Print / PDF
                              <span className="sr-only"> of semester results, {s.label}</span>
                            </a>
                          </span>
                        </Td>
                      </>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-fg mb-3 text-base font-semibold">What each file holds</h2>
          <dl className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <dt className="text-fg font-semibold">Course grades</dt>
              <dd className="text-fg-secondary mt-1">
                One row per student per course: the grade, grade point, credit hours and attempt, with the student&rsquo;s
                College and department.
              </dd>
            </div>
            <div>
              <dt className="text-fg font-semibold">Semester results</dt>
              <dd className="text-fg-secondary mt-1">
                One row per student: credits attempted and earned, semester GPA, CGPA and standing. CGPA and standing are
                worked out as they stood at the end of that semester, so an older semester&rsquo;s file does not change
                with later results.
              </dd>
            </div>
          </dl>
          <p className="text-fg-muted mt-4 text-xs">
            Only published grades appear in either file. A student still waiting on a grade is counted under &ldquo;Not
            yet published&rdquo;; publish those grades first for a final copy.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
