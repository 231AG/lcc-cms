import { BookOpenCheck, Check, GraduationCap, History, Scale, Settings2, X } from "lucide-react";
import type { GradingPolicyView } from "@/lib/grading/policy";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";

/*
 * Hallmark · redesign · page: grading policy · genre: editorial (institutional reference)
 * structure: asymmetric two-column reference sheet -- the scale is the primary
 * read (wide column), rules / standing / history the secondary (narrow column).
 * No eyebrows, nothing centred, no invented figures: every number on this page
 * comes from the grade scale and institution settings the page is given.
 */

type ScaleRow = GradingPolicyView["scale"][number];
type Setting = GradingPolicyView["settings"][number];

/** Settings that describe the rules a student is graded under. Everything
 *  else in institution_setting is office configuration (grade-sheet
 *  signatories, the display time zone, feature switches) and is shown to
 *  staff only. */
const STANDING_KEYS = ["academic_standing_probation_below", "academic_standing_honours_at_or_above"];
const RULE_KEYS = [
  "passing_grade_point",
  "credits_to_graduate",
  "incomplete_resolution_semesters",
  "gpa_decimal_places",
];
const STUDENT_FACING = new Set([...STANDING_KEYS, ...RULE_KEYS]);
/** Settings still stored but no longer applied anywhere, so shown to no
 *  one: there is no per-semester credit ceiling any more (plans of any size
 *  go to the Admin to approve or reject). */
const RETIRED_KEYS = new Set(["max_credits_per_semester"]);

/** Plain-English names for the marks that carry no score range. */
const MARK_NAMES: Record<string, string> = {
  I: "Incomplete",
  W: "Withdrawn",
  AU: "Audit",
  P: "Pass",
  NP: "No pass",
};

/** Readable names for the office-only configuration keys. Unknown keys fall
 *  back to the key itself in sentence case, so a new setting still shows up
 *  sensibly without an edit here. */
const CONFIG_LABELS: Record<string, string> = {
  grade_sheet_signed_name: "Grade sheet: signed by",
  grade_sheet_signed_title: "Grade sheet: signatory's title",
  grade_sheet_approved_name: "Grade sheet: approved by",
  grade_sheet_approved_title: "Grade sheet: approver's title",
  institution_display_timezone: "Time zone for dates",
  prerequisite_override_enabled: "Prerequisite override",
};

/** Office-facing notes that replace a stored description when that
 *  description is a build note rather than an explanation of the setting. */
const CONFIG_NOTES: Record<string, string> = {
  prerequisite_override_enabled:
    "Whether an Admin may approve a course for a student who has not met its prerequisite.",
};

function humanise(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/** The requirement references (REQ-C12, CR-04, DER-27 ...) are for the
 *  people who built the system, not for the office reading this page. */
function plainNote(description: string | null): string | null {
  if (!description) return null;
  const stripped = description
    .replace(/^(?:[A-Z]{2,4}-[A-Z]?\d+[.,]?\s*(?:--\s*)?)+/, "")
    .trim();
  if (!stripped) return null;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function GradingPolicyContent({
  policy,
  showConfiguration,
}: {
  policy: GradingPolicyView;
  /** Office configuration is for Admin and Super Admin; students see the
   *  rules they are graded under and nothing about how the office is set up. */
  showConfiguration: boolean;
}) {
  const setting = (key: string): Setting | undefined => policy.settings.find((s) => s.key === key);
  const num = (key: string): number | null => {
    const v = setting(key)?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const raw = (key: string): string | null => {
    const v = setting(key)?.value;
    return v === undefined || v === null ? null : String(v);
  };

  const scored = policy.scale.filter((r) => r.minScore !== null && r.maxScore !== null);
  const unscored = policy.scale.filter((r) => (r.minScore === null || r.maxScore === null) && !r.isLegacy);
  const legacy = policy.scale.filter((r) => r.isLegacy);

  // The pass mark is read off the scale itself: the lowest score that still
  // lands on a passing letter.
  const passingScored = scored.filter((r) => r.isPassing);
  const passMark = passingScored.length ? Math.min(...passingScored.map((r) => r.minScore as number)) : null;

  const active = policy.versionHistory.find((v) => v.isActive);

  // --- plain-English rules, each only when its setting exists -------------
  const rules: Array<{ term: string; value: string; note: string }> = [];
  const passPoint = num("passing_grade_point");
  if (passPoint !== null) {
    const letter = scored.find((r) => r.gradePoint !== null && Number(r.gradePoint) === passPoint)?.letter;
    const failing = scored.filter((r) => !r.isPassing).map((r) => r.letter);
    rules.push({
      term: "Lowest passing grade",
      value: letter ? `${letter} (${raw("passing_grade_point")})` : (raw("passing_grade_point") ?? ""),
      note: failing.length ? `Anything below it is ${failing.join(" or ")}, a fail.` : "Anything below it is a fail.",
    });
  }
  const toGraduate = num("credits_to_graduate");
  if (toGraduate !== null)
    rules.push({
      term: "Credits needed to graduate",
      value: plural(toGraduate, "credit hour", "credit hours"),
      note: "The total your academic record counts toward.",
    });
  const incompleteWithin = num("incomplete_resolution_semesters");
  if (incompleteWithin !== null)
    rules.push({
      term: "Resolving an Incomplete",
      value: `Within ${plural(incompleteWithin, "semester", "semesters")}`,
      note: "An I must be replaced by a final grade within this time.",
    });
  const places = num("gpa_decimal_places");
  if (places !== null)
    rules.push({
      term: "How GPA is shown",
      value: plural(places, "decimal place", "decimal places"),
      note: "Rounded half-up, once, when it is displayed.",
    });

  // --- academic standing ------------------------------------------------
  const probationBelow = num("academic_standing_probation_below");
  const honoursFrom = num("academic_standing_honours_at_or_above");
  const topPoint = Math.max(4, ...scored.map((r) => Number(r.gradePoint ?? 0)));
  const standing =
    probationBelow !== null && honoursFrom !== null && probationBelow < honoursFrom
      ? {
          probation: raw("academic_standing_probation_below") as string,
          honours: raw("academic_standing_honours_at_or_above") as string,
          probationPct: (probationBelow / topPoint) * 100,
          honoursPct: (honoursFrom / topPoint) * 100,
        }
      : null;

  const configuration = policy.settings.filter((s) => !STUDENT_FACING.has(s.key) && !RETIRED_KEYS.has(s.key));

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-fg text-2xl font-extrabold sm:text-3xl">Grading policy</h1>
          <p className="text-fg-secondary mt-2 text-sm leading-relaxed">
            How a score becomes a letter grade, what each grade is worth, and the rules your academic
            record is calculated under.
          </p>
        </div>
        {active && (
          <p className="text-fg-muted text-sm">
            <span className="text-fg font-semibold">Version {active.policyVersion}</span>
            <span aria-hidden="true"> &middot; </span>
            in effect since {formatDate(active.effectiveFrom)}
          </p>
        )}
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-5">
        {/* ---------------- The scale: the page's primary read ---------------- */}
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle icon={<Scale className="h-4 w-4" aria-hidden="true" />}>Grade scale</CardTitle>
            {passMark !== null && (
              <p className="text-fg-muted text-xs">
                Each bar is the grade&rsquo;s range out of 100. The line marks the pass mark, {passMark}.
              </p>
            )}
          </CardHeader>
          <CardBody className="pt-2">
            <ol className="divide-line-subtle divide-y" aria-label="Letter grades from highest to lowest">
              {scored.map((row) => (
                <ScaleLadderRow key={row.letter} row={row} passMark={passMark} />
              ))}
            </ol>

            {/* A shared axis under the tracks, aligned to the track column. */}
            <div
              className="mt-1 grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] gap-x-4 sm:grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_3rem_4rem]"
              aria-hidden="true"
            >
              <span className="sm:col-span-2" />
              <div className="text-fg-muted relative h-4 text-[10px] tabular-nums">
                {[0, 20, 40, 60, 80, 100].map((t) => (
                  <span
                    key={t}
                    className="absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                    style={{ left: `${t}%` }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {unscored.length > 0 && (
              <div className="border-line-subtle mt-6 border-t pt-5">
                <h3 className="text-fg text-sm font-bold">Marks without a score</h3>
                <dl className="mt-3 flex flex-col gap-3">
                  {unscored.map((row) => (
                    <div key={row.letter} className="flex gap-4">
                      <dt className="text-fg w-12 shrink-0 text-2xl leading-none font-extrabold">{row.letter}</dt>
                      <dd className="text-fg-secondary text-sm leading-relaxed">
                        <span className="text-fg font-semibold">{MARK_NAMES[row.letter] ?? row.letter}.</span>{" "}
                        {row.gradePoint === null ? "Carries no grade point" : `Worth ${row.gradePoint} points`}
                        {row.countsInGpa ? " and counts toward your GPA." : " and is left out of your GPA."}
                        {row.letter === "I" && incompleteWithin !== null
                          ? ` It must be resolved within ${plural(incompleteWithin, "semester", "semesters")}.`
                          : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {legacy.length > 0 && (
              <div className="border-line-subtle mt-6 border-t pt-5">
                <h3 className="text-fg text-sm font-bold">Older grades</h3>
                <p className="text-fg-secondary mt-1 text-sm leading-relaxed">
                  Grade sheets issued before this scale used plain letters. They are kept exactly as issued on past
                  records and count toward GPA at these values. New grades always use the scale above.
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                  {legacy.map((row) => (
                    <div key={row.letter} className="flex items-baseline gap-2">
                      <dt className="text-fg text-xl leading-none font-extrabold">{row.letter}</dt>
                      <dd className="text-fg-secondary text-sm tabular-nums">{row.gradePoint}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ---------------- Rules, standing and history ---------------- */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          {standing && (
            <Card>
              <CardHeader>
                <CardTitle icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}>Academic standing</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-fg-secondary text-sm">Set by your cumulative GPA (CGPA), out of {topPoint.toFixed(2)}.</p>
                <div className="mt-4" aria-hidden="true">
                  <div className="flex h-3 overflow-hidden rounded-full">
                    <span className="bg-warning-solid" style={{ width: `${standing.probationPct}%` }} />
                    <span className="bg-primary/70 border-surface border-x-2" style={{ width: `${standing.honoursPct - standing.probationPct}%` }} />
                    <span className="bg-success-solid" style={{ width: `${100 - standing.honoursPct}%` }} />
                  </div>
                  <div className="text-fg-muted relative mt-1.5 h-4 text-[10px] tabular-nums">
                    <span className="absolute left-0">0.00</span>
                    <span className="absolute -translate-x-1/2" style={{ left: `${standing.probationPct}%` }}>
                      {standing.probation}
                    </span>
                    <span className="absolute -translate-x-1/2" style={{ left: `${standing.honoursPct}%` }}>
                      {standing.honours}
                    </span>
                    <span className="absolute right-0">{topPoint.toFixed(2)}</span>
                  </div>
                </div>
                <dl className="mt-4 flex flex-col gap-2.5 text-sm">
                  <StandingRow swatch="bg-success-solid" name="Honours" range={`${standing.honours} and above`} />
                  <StandingRow swatch="bg-primary/70" name="Good standing" range={`${standing.probation} to below ${standing.honours}`} />
                  <StandingRow swatch="bg-warning-solid" name="Probation" range={`Below ${standing.probation}`} />
                </dl>
              </CardBody>
            </Card>
          )}

          {rules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle icon={<BookOpenCheck className="h-4 w-4" aria-hidden="true" />}>Rules</CardTitle>
              </CardHeader>
              <CardBody className="py-2">
                <dl className="divide-line-subtle divide-y">
                  {rules.map((r) => (
                    <div key={r.term} className="py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                        <dt className="text-fg-secondary text-sm">{r.term}</dt>
                        <dd className="text-fg text-sm font-bold tabular-nums">{r.value}</dd>
                      </div>
                      <p className="text-fg-muted mt-1 text-xs leading-relaxed">{r.note}</p>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          )}

          {policy.versionHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle icon={<History className="h-4 w-4" aria-hidden="true" />}>Version history</CardTitle>
              </CardHeader>
              <CardBody>
                <ol className="border-line relative ml-1.5 flex flex-col gap-4 border-l pl-5">
                  {policy.versionHistory.map((v) => (
                    <li key={v.policyVersion} className="relative">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-1.5 -left-[1.6rem] h-2.5 w-2.5 rounded-full ring-4 ring-[var(--surface)]",
                          v.isActive ? "bg-primary" : "bg-line-strong",
                        )}
                      />
                      <p className="text-fg flex items-center gap-2 text-sm font-semibold">
                        Version {v.policyVersion}
                        {v.isActive && <Badge tone="success">In effect</Badge>}
                      </p>
                      <p className="text-fg-muted text-xs">From {formatDate(v.effectiveFrom)}</p>
                    </li>
                  ))}
                </ol>
                <p className="text-fg-muted mt-4 text-xs leading-relaxed">
                  Every result is calculated under the version in effect when it was recorded. An older version is
                  never edited, only replaced by a newer one.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {showConfiguration && configuration.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle icon={<Settings2 className="h-4 w-4" aria-hidden="true" />}>Office configuration</CardTitle>
            <p className="text-fg-muted text-xs">Visible to Admin and Super Admin only.</p>
          </CardHeader>
          <CardBody className="py-2">
            <dl className="divide-line-subtle grid divide-y md:grid-cols-2 md:gap-x-10 md:divide-y-0">
              {configuration.map((s) => {
                const note = CONFIG_NOTES[s.key] ?? plainNote(s.description);
                return (
                  <div key={s.key} className="border-line-subtle py-3 md:border-b">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-fg-secondary text-sm">{CONFIG_LABELS[s.key] ?? humanise(s.key)}</dt>
                      <dd className="text-fg text-sm font-semibold">{formatValue(s.value)}</dd>
                    </div>
                    {note && <p className="text-fg-muted mt-0.5 text-xs">{note}</p>}
                  </div>
                );
              })}
            </dl>
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** One letter on the ladder: the letter, its range as text and as a bar on
 *  a 0-100 track, its grade point, and pass/fail in words with an icon --
 *  colour is never the only thing saying which is which. */
function ScaleLadderRow({ row, passMark }: { row: ScaleRow; passMark: number | null }) {
  const min = row.minScore as number;
  const max = row.maxScore as number;
  const left = Math.max(0, Math.min(100, min));
  const width = Math.max(1, Math.min(100, max + 1) - left);
  const range = `${min}–${max}`;

  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_3rem_4rem]">
      <span className="text-fg text-2xl leading-none font-extrabold">{row.letter}</span>
      <span className="text-fg-secondary hidden text-sm tabular-nums sm:block">{range}</span>

      <div className="min-w-0">
        <span className="text-fg-muted mb-1 block text-xs tabular-nums sm:hidden">{range}</span>
        <div className="bg-surface-subtle relative h-2.5 rounded-full" title={`${row.letter}: ${range}`}>
          <span
            className={cn("absolute inset-y-0 rounded-full", row.isPassing ? "bg-primary" : "bg-danger-solid")}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
          {passMark !== null && (
            <span
              aria-hidden="true"
              className="bg-fg-muted absolute -inset-y-1.5 w-px"
              style={{ left: `${passMark}%` }}
            />
          )}
        </div>
      </div>

      <span className="text-fg hidden text-right text-sm font-bold tabular-nums sm:block">{row.gradePoint ?? "—"}</span>
      <span
        className={cn(
          "flex items-center justify-end gap-1 text-xs font-semibold",
          row.isPassing ? "text-success-fg" : "text-danger-fg",
        )}
      >
        <span className="text-fg mr-1 text-sm font-bold tabular-nums sm:hidden">{row.gradePoint ?? "—"}</span>
        {row.isPassing ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
        {row.isPassing ? "Pass" : "Fail"}
      </span>
    </li>
  );
}

function StandingRow({ swatch, name, range }: { swatch: string; name: string; range: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", swatch)} />
      <dt className="text-fg font-semibold">{name}</dt>
      <dd className="text-fg-muted ml-auto text-right tabular-nums">{range}</dd>
    </div>
  );
}
