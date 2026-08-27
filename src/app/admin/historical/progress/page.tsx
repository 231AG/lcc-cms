import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getImportProgressReport } from "@/lib/historical/historical";

/**
 * A-16 (plan Section 20.4, REQ-H06): institution-wide import progress.
 * Admin and Super Admin both get read access -- there's nothing to write
 * here, only counts.
 */
export default async function ImportProgressPage() {
  const actor = await getCurrentActor();

  if (!actor) return <main className="p-8">Please sign in.</main>;
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto max-w-lg p-8">
        <p className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not available to your role.
        </p>
      </main>
    );
  }

  const report = await getImportProgressReport(actor);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">Historical import progress</h1>
      <p className="mb-6 text-sm text-gray-500">
        <Link href="/admin/students" className="text-blue-700 underline">
          Students
        </Link>
      </p>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Status</th>
            <th className="py-1">Students</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.byStatus).map(([status, count]) => (
            <tr key={status} className="border-b">
              <td className="py-1">{status}</td>
              <td className="py-1">{count}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 font-medium">Total</td>
            <td className="py-1 font-medium">{report.totalStudents}</td>
          </tr>
        </tbody>
      </table>

      <p className="text-sm">
        <strong>{report.unknownCourseIssues}</strong> entered record(s) reference a course code not in the
        catalogue -- open the relevant student&apos;s record to review.
      </p>
    </main>
  );
}
