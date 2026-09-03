import type { Metadata } from "next";
import { getCurrentActor } from "@/lib/auth/session";
import { getGradingPolicy } from "@/lib/grading/policy";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";

export const metadata: Metadata = { title: "Grading policy" };

/**
 * X-08 (plan Section 20.5) -- available to every signed-in role
 * (Student/Admin/Super Admin all hold `gradingPolicy.view`). Placed
 * outside /admin since a Student needs to reach it too.
 */
export default async function GradingPolicyPage() {
  const actor = await getCurrentActor();
  if (!actor)
    return (
      <main id="main-content" tabIndex={-1} className="flex-1 p-8 outline-none">
        Please sign in.
      </main>
    );

  const policy = await getGradingPolicy(actor);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 outline-none sm:py-10">
      <PageHeader title="Grading policy" description={`Active grade scale (policy version ${policy.activeVersion}).`} />

      <Card className="mb-8">
        <Table>
          <Thead>
            <tr>
              <Th>Letter</Th>
              <Th>Score range</Th>
              <Th>Grade point</Th>
              <Th>Passing</Th>
              <Th>Counts in GPA</Th>
            </tr>
          </Thead>
          <tbody>
            {policy.scale.map((row) => (
              <Tr key={row.letter}>
                <Td className="font-mono font-medium text-fg">{row.letter}</Td>
                <Td>{row.minScore !== null && row.maxScore !== null ? `${row.minScore}–${row.maxScore}` : "—"}</Td>
                <Td>{row.gradePoint ?? "—"}</Td>
                <Td>{row.isPassing ? "Yes" : "No"}</Td>
                <Td>{row.countsInGpa ? "Yes" : "No"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-fg-secondary">Institution settings</h2>
      <Card className="mb-8">
        <Table>
          <tbody>
            {policy.settings.map((s) => (
              <Tr key={s.key}>
                <Td className="pr-4 font-mono text-xs text-fg-muted">{s.key}</Td>
                <Td className="pr-4">{JSON.stringify(s.value)}</Td>
                <Td className="text-xs text-fg-muted">{s.description}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-fg-secondary">Version history</h2>
      <p className="mb-3 text-xs text-fg-muted">
        Every academic record was computed under the policy version in effect at the time -- an older version
        is never edited, only superseded.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {policy.versionHistory.map((v) => (
          <li key={v.policyVersion}>
            <Card>
              <CardBody className="flex items-center justify-between py-2.5">
                <span className="font-medium text-fg">Version {v.policyVersion}</span>
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  effective from {new Date(v.effectiveFrom).toISOString().slice(0, 10)}
                  {v.isActive && <Badge tone="success">Active</Badge>}
                </span>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
