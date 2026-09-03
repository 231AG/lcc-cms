import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { asUser } from "@/lib/db/asUser";
import { legalNextStates, type SemesterState } from "@/lib/academic/semesterStateMachine";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { createAcademicYearAction, createSemesterAction, transitionSemesterAction } from "./actions";

export const metadata: Metadata = { title: "Academic calendar" };

const STATE_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  REGISTRATION: "info",
  OPEN: "success",
  IN_PROGRESS: "brand",
  CLOSED: "neutral",
};

/**
 * Academic years, semesters, and state transitions (Section 20.4, Stage 4).
 * Visible to both Admin (create years/semesters, advance forward) and Super
 * Admin (move backward/reopen, with a mandatory reason) -- unlike
 * /admin/structure, which is Admin-only, this screen has real content for
 * both roles, matching Section 11.3's "Advance forward is Admin-only, move
 * backwards is Super-Admin-only" split rather than a single-role screen.
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

        <Card>
          <Table>
            <Thead>
              <tr>
                <Th>Academic year</Th>
                <Th>Seq</Th>
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Transition</Th>
              </tr>
            </Thead>
            <tbody>
              {semesters.map((s) => {
                const currentState = s.state as SemesterState;
                const availableRules = legalNextStates(currentState).filter((r) => r.actorRole === actor.role);
                return (
                  <Tr key={s.id} className="align-top">
                    <Td>{yearLabel(s.academicYearId)}</Td>
                    <Td>{s.sequence}</Td>
                    <Td className="font-medium text-fg">{s.name}</Td>
                    <Td>
                      <Badge tone={STATE_TONE[s.state] ?? "neutral"}>{s.state}</Badge>
                    </Td>
                    <Td>
                      {availableRules.length === 0 && (
                        <span className="text-fg-subtle">
                          {actor.role === "ADMIN" ? "No forward move available" : "No backward move available"}
                        </span>
                      )}
                      <div className="flex flex-col gap-2">
                        {availableRules.map((rule) => (
                          <form key={rule.to} action={transitionSemesterAction} className="flex items-end gap-2">
                            <input type="hidden" name="semesterId" value={s.id} />
                            <input type="hidden" name="toState" value={rule.to} />
                            {rule.reasonRequired && (
                              <input
                                name="reason"
                                required
                                placeholder="Reason (required)"
                                className="w-48 rounded-md border border-line-strong px-2 py-1 text-xs"
                              />
                            )}
                            <Button type="submit" variant="secondary" size="sm">
                              {rule.actorRole === "ADMIN" ? "Advance to" : "Move back to"} {rule.to}
                            </Button>
                          </form>
                        ))}
                      </div>
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
