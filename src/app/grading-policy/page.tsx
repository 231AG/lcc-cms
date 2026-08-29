import { getCurrentActor } from "@/lib/auth/session";
import { getGradingPolicy } from "@/lib/grading/policy";

/**
 * X-08 (plan Section 20.5) -- available to every signed-in role
 * (Student/Admin/Super Admin all hold `gradingPolicy.view`). Placed
 * outside /admin since a Student needs to reach it too.
 */
export default async function GradingPolicyPage() {
  const actor = await getCurrentActor();
  if (!actor) return <main className="p-8">Please sign in.</main>;

  const policy = await getGradingPolicy(actor);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold">Grading policy</h1>
      <p className="mb-6 text-sm text-gray-600">Active grade scale (policy version {policy.activeVersion}).</p>

      <table className="mb-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Letter</th>
            <th className="py-1">Score range</th>
            <th className="py-1">Grade point</th>
            <th className="py-1">Passing</th>
            <th className="py-1">Counts in GPA</th>
          </tr>
        </thead>
        <tbody>
          {policy.scale.map((row) => (
            <tr key={row.letter} className="border-b">
              <td className="py-1 font-mono">{row.letter}</td>
              <td className="py-1">{row.minScore !== null && row.maxScore !== null ? `${row.minScore}–${row.maxScore}` : "—"}</td>
              <td className="py-1">{row.gradePoint ?? "—"}</td>
              <td className="py-1">{row.isPassing ? "Yes" : "No"}</td>
              <td className="py-1">{row.countsInGpa ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Institution settings</h2>
      <table className="mb-8 w-full border-collapse text-sm">
        <tbody>
          {policy.settings.map((s) => (
            <tr key={s.key} className="border-b">
              <td className="py-1 pr-4 font-mono text-xs text-gray-500">{s.key}</td>
              <td className="py-1 pr-4">{JSON.stringify(s.value)}</td>
              <td className="py-1 text-xs text-gray-500">{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Version history</h2>
      <p className="mb-2 text-xs text-gray-500">
        Every academic record was computed under the policy version in effect at the time -- an older version
        is never edited, only superseded.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {policy.versionHistory.map((v) => (
          <li key={v.policyVersion} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
            <span>Version {v.policyVersion}</span>
            <span className="text-xs text-gray-500">
              effective from {new Date(v.effectiveFrom).toISOString().slice(0, 10)}
              {v.isActive && <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-green-800">Active</span>}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
