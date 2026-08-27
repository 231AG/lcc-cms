import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudent } from "@/lib/students/students";
import { asUser } from "@/lib/db/asUser";
import { getStudentHistory } from "@/lib/historical/historical";
import { getCumulativeSummary, getOutstandingRepeatObligations, getSemesterSummaries } from "@/lib/gpa/gpa";
import { computeIncompleteDeadlineSemester, formatSemesterSortKey } from "@/lib/gpa/incompleteDeadline";

const STANDING_LABEL: Record<string, string> = {
  HONOURS: "Honours",
  GOOD_STANDING: "Good standing",
  PROBATION: "Probation",
};

const ADMIN_LINKS = [
  { href: "/admin/students", label: "Students" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/structure", label: "Academic structure" },
  { href: "/admin/calendar", label: "Academic calendar" },
];

const SUPER_ADMIN_LINKS = [
  { href: "/admin/accounts", label: "Admin accounts" },
  { href: "/admin/students", label: "Students (read-only)" },
  { href: "/admin/historical/progress", label: "Historical import progress" },
  { href: "/admin/calendar", label: "Academic calendar (read-only)" },
];

/**
 * Landing page. Students see S-09 (their own read-only profile, plan
 * Section 20.3) as of Stage 5. Admin/Super Admin see the Stage 2
 * placeholder plus a plain list of the screens available to their role --
 * full role-specific dashboards (A-01/X-01) are their own later screens,
 * but every stage since 2 has shipped a real admin page with no way to
 * reach it except typing the URL, which is a genuine dead end.
 */
export default async function PortalPage() {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect("/login");
  }

  if (actor.mustChangePassword) {
    redirect("/change-password");
  }

  if (actor.role === "STUDENT") {
    const record = await getStudent(actor, actor.userId);
    const [department, history, semesterSummaries, cumulative, obligations, semesters, academicYears] = await Promise.all([
      asUser(actor.userId, (tx) => tx.query.department.findFirst({ where: (d, { eq }) => eq(d.id, record.departmentId) })),
      getStudentHistory(actor, actor.userId),
      getSemesterSummaries(actor, actor.userId),
      getCumulativeSummary(actor, actor.userId),
      getOutstandingRepeatObligations(actor, actor.userId),
      asUser(actor.userId, (tx) => tx.query.semester.findMany()),
      asUser(actor.userId, (tx) => tx.query.academicYear.findMany()),
    ]);

    const semesterInfo = (semesterId: string) => {
      const sem = semesters.find((s) => s.id === semesterId);
      const year = sem ? academicYears.find((y) => y.id === sem.academicYearId) : undefined;
      return sem && year
        ? { label: `${year.label} — ${sem.name}`, sortKey: { yearStart: new Date(year.startDate).getFullYear(), sequence: sem.sequence as 1 | 2 } }
        : null;
    };
    const semesterSummaryFor = (semesterId: string) => semesterSummaries.find((s) => s.semesterId === semesterId);
    const isProvisional = cumulative?.isProvisional ?? record.historicalImportStatus !== "COMPLETE";

    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-2 text-xl font-semibold">
          {record.firstName} {record.lastName}
        </h1>
        <p className="mb-6 text-sm text-gray-500">Student ID {record.studentNumber}</p>
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Department</dt>
          <dd>{department ? `${department.code} — ${department.name}` : "—"}</dd>
          <dt className="text-gray-500">Enrolment year</dt>
          <dd>{record.enrolmentYear}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd>{record.status}</dd>
        </dl>

        <section className="mb-6 rounded border border-gray-200 p-4">
          <h2 className="mb-2 font-medium">Academic record</h2>
          {isProvisional && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Provisional -- based on records entered so far. Your academic history is still being entered by the
              Admin office.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">CGPA</dt>
            <dd>{cumulative?.cgpa ?? "—"}</dd>
            <dt className="text-gray-500">Academic standing</dt>
            <dd>{cumulative?.standing ? STANDING_LABEL[cumulative.standing] : "Not yet available"}</dd>
            <dt className="text-gray-500">Credits earned</dt>
            <dd>{cumulative ? `${cumulative.totalCreditsEarned} of 132 -- ${cumulative.creditsToGraduation} remaining` : "—"}</dd>
            <dt className="text-gray-500">Credits attempted</dt>
            <dd>{cumulative?.totalCreditsAttempted ?? "—"}</dd>
          </dl>
        </section>

        {obligations.length > 0 && (
          <section className="mb-6 rounded border border-amber-300 bg-amber-50 p-4">
            <h2 className="mb-2 font-medium">Outstanding repeats</h2>
            <ul className="list-disc pl-5 text-sm">
              {obligations.map((o) => (
                <li key={o.recordId}>
                  {o.courseCode} — {o.courseTitle} ({o.letter})
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded border border-gray-200 p-4">
          <h2 className="mb-3 font-medium">Semesters</h2>
          {history.length === 0 && <p className="text-sm text-gray-500">No results yet.</p>}
          {[...new Set(history.map((r) => r.semesterId))].map((semesterId) => {
            const info = semesterInfo(semesterId);
            const summary = semesterSummaryFor(semesterId);
            const courses = history.filter((r) => r.semesterId === semesterId);
            return (
              <div key={semesterId} className="mb-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">{info?.label ?? semesterId}</h3>
                  <span className="text-xs text-gray-500">
                    GPA {summary?.gpa ?? "—"} {summary?.isProvisional && "(provisional)"}
                  </span>
                </div>
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="py-1">
                          {c.courseCodeSnapshot} — {c.courseTitleSnapshot}
                        </td>
                        <td className="py-1">{c.creditHours}cr</td>
                        <td className="py-1">
                          {c.letter}
                          {c.isRepeatDropped && " (R)"}
                          {c.letter === "I" && info && (
                            <span className="ml-1 text-xs text-amber-700">
                              -- must be resolved by end of {formatSemesterSortKey(computeIncompleteDeadlineSemester(info.sortKey))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        <p className="mt-6 text-sm">
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </p>
      </main>
    );
  }

  const links = actor.role === "SUPER_ADMIN" ? SUPER_ADMIN_LINKS : ADMIN_LINKS;

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-xl font-semibold">Signed in</h1>
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd>{actor.displayName}</dd>
        <dt className="text-gray-500">Login identifier</dt>
        <dd>{actor.loginIdentifier}</dd>
        <dt className="text-gray-500">Role</dt>
        <dd>{actor.role}</dd>
      </dl>
      <ul className="flex flex-col gap-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-blue-700 underline">
              {link.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/change-password" className="text-blue-700 underline">
            Change password
          </Link>
        </li>
      </ul>
    </main>
  );
}
