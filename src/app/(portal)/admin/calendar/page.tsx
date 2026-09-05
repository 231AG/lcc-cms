import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import {
  isDeletable,
  legalNextStatesForRole,
  reasonRequiredFor,
  SEMESTER_STATE_DESCRIPTION,
  SEMESTER_STATE_LABEL,
  type SemesterState,
} from "@/lib/academic/semesterStateMachine";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { SemesterStateBadge } from "@/components/ui/SemesterStateBadge";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { createAcademicYearAction, createSemesterAction, deleteSemesterAction, transitionSemesterAction } from "./actions";

export const metadata: Metadata = { title: "Academic calendar" };

/**
 * Academic years, semesters, and state changes (Section 20.4, Stage 4).
 *
 * Creating years and semesters stays Admin-only; CHANGING a semester's
 * state is now held by both staff roles, which is the one split this screen
 * still draws. The Super Admin's extra power is the reopen out of Closed,
 * not a general ability to move a semester backwards -- the lifecycle is
 * forward-only for everybody (see semesterStateMachine.ts).
 *
 * The state control is a dropdown rather than the old forward/back stepper:
 * you choose the state you want. That reads as a choice even where, as
 * today, exactly one state is legal from where you are.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  const { error } = await searchParams;

  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 p-8 outline-none">
        <Alert tone="info">Not available to your role.</Alert>
      </main>
    );
  }

  const [years, semesters] = await asUser(actor.userId, async (tx) => {
    return Promise.all([
      tx.query.academicYear.findMany({ orderBy: (row, { asc }) => asc(row.label) }),
      tx.query.semester.findMany({ orderBy: (row, { asc }) => [asc(row.academicYearId), asc(row.sequence)] }),
    ]);
  });

  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? id;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Academic calendar" />

      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Academic years */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-fg">Academic years</h2>

        {actor.role === "ADMIN" && (
          <form action={createAcademicYearAction} className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs" htmlFor="year-label">
                Label
              </Label>
              <Input id="year-label" name="label" required placeholder="2026/2027" />
            </div>
            <div>
              <Label className="text-xs" htmlFor="year-start">
                Start date
              </Label>
              <Input id="year-start" name="startDate" type="date" required />
            </div>
            <div>
              <Label className="text-xs" htmlFor="year-end">
                End date
              </Label>
              <Input id="year-end" name="endDate" type="date" required />
            </div>
            <Button type="submit">Add academic year</Button>
          </form>
        )}

        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Label</Th>
                <Th>Start</Th>
                <Th>End</Th>
              </tr>
            </Thead>
            <tbody>
              {years.map((y) => (
                <Tr key={y.id}>
                  <Td className="font-medium text-fg">{y.label}</Td>
                  <Td>{y.startDate}</Td>
                  <Td>{y.endDate}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* Semesters */}
      <section>
        <h2 className="mb-3 font-medium text-fg">Semesters</h2>

        {actor.role === "ADMIN" && (
          <form action={createSemesterAction} className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs" htmlFor="sem-year">
                Academic year
              </Label>
              <Select id="sem-year" name="academicYearId" required>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="sem-sequence">
                Sequence
              </Label>
              <Select id="sem-sequence" name="sequence" required>
                <option value="1">1 (First)</option>
                <option value="2">2 (Second)</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="sem-name">
                Name
              </Label>
              <Input id="sem-name" name="name" required placeholder="First Semester" />
            </div>
            <div>
              <Label className="text-xs" htmlFor="sem-start">
                Start date
              </Label>
              <Input id="sem-start" name="startDate" type="date" required />
            </div>
            <div>
              <Label className="text-xs" htmlFor="sem-end">
                End date
              </Label>
              <Input id="sem-end" name="endDate" type="date" required />
            </div>
            <Button type="submit">Add semester</Button>
          </form>
        )}

        <Card className="overflow-hidden">
          <Table>
            <Thead>
              <tr>
                <Th>Academic year</Th>
                <Th className="hidden sm:table-cell">Seq</Th>
                <Th>Name</Th>
                <Th className="hidden md:table-cell">Dates</Th>
                <Th>State</Th>
                <Th>Change state</Th>
              </tr>
            </Thead>
            <tbody>
              {semesters.map((s) => {
                const currentState = s.state as SemesterState;
                // Both staff roles can move a semester forward now; only a
                // Super Admin sees the reopen out of Closed. Whichever
                // states this actor may pick are what the dropdown offers,
                // so an unavailable move is never rendered as a dead option.
                const available = legalNextStatesForRole(currentState, actor.role);
                // Every state has at most one legal next state per role, so
                // one reason rule covers the whole row.
                const reasonRequired = available.some((rule) => reasonRequiredFor(rule, actor.role));
                const isReopen = available.some((rule) => rule.isReopen);
                return (
                  <Tr key={s.id} className="align-top">
                    <Td>{yearLabel(s.academicYearId)}</Td>
                    <Td className="hidden sm:table-cell">{s.sequence}</Td>
                    <Td className="font-medium text-fg">{s.name}</Td>
                    <Td className="hidden whitespace-nowrap text-xs text-fg-secondary md:table-cell">
                      {s.startDate} &ndash; {s.endDate}
                    </Td>
                    <Td>
                      <SemesterStateBadge state={s.state} />
                      <p className="mt-1 max-w-56 text-xs text-fg-muted">{SEMESTER_STATE_DESCRIPTION[currentState]}</p>
                    </Td>
                    <Td>
                      {available.length === 0 ? (
                        <span className="text-xs text-fg-muted">
                          {currentState === "CLOSED"
                            ? "Closed and sealed. Only a Super Admin can reopen it."
                            : "No further change available to you."}
                        </span>
                      ) : (
                        /* A dropdown, not a stepper: you pick the state you
                           want rather than clicking through the ones in
                           between. The lifecycle is still forward-only --
                           the select simply lists what is legal from here,
                           which for every state is at most one thing. */
                        <form action={transitionSemesterAction} className="flex flex-col gap-2">
                          <input type="hidden" name="semesterId" value={s.id} />
                          <div>
                            <Label htmlFor={`toState-${s.id}`} className="text-xs">
                              Move to
                            </Label>
                            <Select id={`toState-${s.id}`} name="toState" required defaultValue={available[0].to} className="w-40 text-xs">
                              {available.map((rule) => (
                                <option key={rule.to} value={rule.to}>
                                  {SEMESTER_STATE_LABEL[rule.to]}
                                  {rule.isReopen ? " (reopen)" : ""}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`reason-${s.id}`} className="text-xs">
                              Reason {reasonRequired ? "(required)" : "(optional)"}
                            </Label>
                            <Input
                              id={`reason-${s.id}`}
                              name="reason"
                              required={reasonRequired}
                              placeholder={isReopen ? "Why is this being reopened?" : "Why is this changing?"}
                              className="w-full max-w-56 py-1 text-xs"
                            />
                          </div>
                          <Button type="submit" variant={isReopen ? "secondary" : "primary"} size="sm" className="w-fit">
                            {isReopen ? "Reopen semester" : "Change state"}
                          </Button>
                        </form>
                      )}

                      {/* Deleting is possible only from Draft, and only for
                          the role that creates semesters. Behind a
                          disclosure rather than a one-click button, because
                          the app's CSP forbids the inline handler a
                          confirm() dialog would need. */}
                      {actor.role === "ADMIN" && isDeletable(currentState) && (
                        <details className="mt-3">
                          <summary className="cursor-pointer list-none text-xs font-medium text-danger-fg hover:underline">Delete</summary>
                          <form action={deleteSemesterAction} className="mt-1.5 flex flex-col gap-1.5">
                            <input type="hidden" name="semesterId" value={s.id} />
                            <p className="max-w-56 text-xs text-fg-muted">
                              A Draft has no plans, registrations or grades, so nothing is lost. This cannot be undone.
                            </p>
                            <Button type="submit" variant="danger" size="sm" className="w-fit">
                              Delete this semester
                            </Button>
                          </form>
                        </details>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </section>
    </main>
  );
}
