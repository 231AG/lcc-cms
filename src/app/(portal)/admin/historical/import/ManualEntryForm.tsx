"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Form";
import { cn } from "@/components/ui/cn";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";
import type { ManualEntryCheck, ManualEntryResult } from "@/lib/historical/manualEntry";
import { checkManualEntryAction, saveManualEntryAction } from "./actions";

/**
 * One student's past semester, typed in from the paper grade sheet.
 *
 * Grade points and the GPA are worked out on screen as the grades go in;
 * the points and GPA printed on the paper can be typed beside them as a
 * check. Nothing is saved from this screen's own arithmetic: "Check" asks
 * the server, which works it all out again, and "Save" asks it once more.
 * Any edit after a check clears it, so what is saved is always what was
 * last checked.
 */

export interface ManualEntryFormProps {
  student: { id: string; name: string; studentNumber: string; departmentId: string; departmentName: string; enrolmentYear: number };
  years: Array<{
    label: string;
    inCalendar: boolean;
    semesters: Array<{ sequence: 1 | 2; inCalendar: boolean; ended: boolean | null; grades: number }>;
  }>;
  courses: Array<{ code: string; title: string; creditHours: number }>;
  departments: Array<{ id: string; name: string }>;
  grades: Array<{ letter: string; gradePoint: number | null; countsInGpa: boolean; legacy: boolean }>;
}

interface Row {
  key: number;
  code: string;
  hours: string;
  /** The hours were filled in from the catalogue, not typed. */
  hoursAuto: boolean;
  letter: string;
  paper: string;
  mode: "catalogue" | "asPrinted";
  newTitle: string;
  newDept: string;
}

let nextKey = 1;
const blankRow = (dept: string): Row => ({
  key: nextKey++,
  code: "",
  hours: "",
  hoursAuto: false,
  letter: "",
  paper: "",
  mode: "catalogue",
  newTitle: "",
  newDept: dept,
});

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const numberOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export default function ManualEntryForm({ student, years, courses, departments, grades }: ManualEntryFormProps) {
  const firstOpen = years.find((y) => y.semesters.some((s) => s.ended !== false)) ?? years[0];
  const [yearLabel, setYearLabel] = useState(firstOpen?.label ?? "");
  const [sequence, setSequence] = useState<1 | 2>(1);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 6 }, () => blankRow(student.departmentId)));
  const [paperGpa, setPaperGpa] = useState("");
  const [check, setCheck] = useState<ManualEntryCheck | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<ManualEntryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const catalogue = useMemo(() => new Map(courses.map((c) => [courseCodeKey(c.code), c])), [courses]);
  const gradeByLetter = useMemo(() => new Map(grades.map((g) => [g.letter.toUpperCase(), g])), [grades]);
  const year = years.find((y) => y.label === yearLabel);

  // Any change makes the last check stale.
  const touched = () => {
    setCheck(null);
    setConfirmed(false);
    setError(null);
  };

  const update = (key: number, patch: Partial<Row>) => {
    touched();
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.code !== undefined) {
          const listed = catalogue.get(courseCodeKey(patch.code));
          // Fill the hours from the catalogue unless they were typed.
          if (listed && (r.hoursAuto || r.hours === "")) {
            next.hours = String(listed.creditHours);
            next.hoursAuto = true;
          } else if (!listed && r.hoursAuto) {
            next.hours = "";
            next.hoursAuto = false;
          }
        }
        if (patch.hours !== undefined) next.hoursAuto = false;
        return next;
      }),
    );
  };

  // ---- Live arithmetic, for the screen only ----------------------------------
  const live = rows.map((r) => {
    const listed = r.code.trim() ? catalogue.get(courseCodeKey(r.code)) : undefined;
    const h = Number(r.hours);
    const hoursOk = r.hours.trim() !== "" && Number.isFinite(h) && h > 0;
    const g = gradeByLetter.get(r.letter.toUpperCase());
    const points = g && hoursOk && g.countsInGpa && g.gradePoint !== null ? Number((g.gradePoint * h).toFixed(2)) : null;
    const paper = numberOrNull(r.paper);
    const paperState: "none" | "ok" | "off" =
      paper === null || !g || !hoursOk ? "none" : (points ?? 0) === paper ? "ok" : "off";
    return {
      listed,
      blank: !r.code.trim() && !r.letter,
      hoursOk,
      h,
      g,
      points,
      paperState,
      hoursDiffer: Boolean(listed && hoursOk && h !== listed.creditHours),
    };
  });
  const counted = live.filter((l) => l.g && l.hoursOk && l.g.countsInGpa);
  const gpaHours = counted.reduce((s, l) => s + l.h, 0);
  const totalPoints = counted.reduce((s, l) => s + (l.points ?? 0), 0);
  const gpa = gpaHours > 0 ? Math.round((totalPoints / gpaHours + Number.EPSILON) * 100) / 100 : null;
  const paperGpaNum = numberOrNull(paperGpa);
  const filled = rows.filter((_, i) => !live[i].blank).length;

  const payload = (withConfirm: boolean) => ({
    studentId: student.id,
    yearLabel,
    sequence,
    paperGpa: paperGpaNum,
    confirmed: withConfirm,
    rows: rows
      .filter((_, i) => !live[i].blank)
      .map((r) => {
        const listed = catalogue.get(courseCodeKey(r.code));
        return {
          code: r.code,
          creditHours: Number(r.hours),
          letter: r.letter,
          paperPoints: numberOrNull(r.paper),
          newCourse: listed
            ? undefined
            : r.mode === "catalogue"
              ? { mode: "catalogue" as const, title: r.newTitle, departmentId: r.newDept }
              : { mode: "asPrinted" as const, title: r.newTitle },
        };
      }),
  });

  const runCheck = () => {
    setError(null);
    setConfirmed(false);
    startTransition(async () => {
      const out = await checkManualEntryAction(payload(false));
      if (!out.ok) setError(out.error);
      else setCheck(out.check);
    });
  };

  const runSave = () => {
    setError(null);
    startTransition(async () => {
      const out = await saveManualEntryAction(payload(confirmed));
      if (!out.ok) setError(out.error);
      else {
        setSaved(out.result);
        setCheck(null);
      }
    });
  };

  const startAnother = () => {
    setSaved(null);
    setRows(Array.from({ length: 6 }, () => blankRow(student.departmentId)));
    setPaperGpa("");
    setConfirmed(false);
  };

  // ---- Saved -------------------------------------------------------------
  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success">
            <p className="font-semibold">
              Saved {saved.saved} grade{saved.saved === 1 ? "" : "s"} for {student.name} ({student.studentNumber}), {saved.semester}.
            </p>
            {saved.createdSemester && <p className="mt-1">{saved.createdSemester.replace("will be created", "was created")}</p>}
            {saved.createdCourses.length > 0 && <p className="mt-1">Added to the catalogue: {saved.createdCourses.join("; ")}.</p>}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button onClick={startAnother}>Enter another semester</Button>
            <Link href={`/admin/students/${student.id}`} className={buttonClasses("secondary")}>
              Open profile
            </Link>
            <Link href="/admin/historical/import?tab=hand" className={buttonClasses("secondary")}>
              Choose another student
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  const semInfo = year?.semesters.find((s) => s.sequence === sequence);

  return (
    <div className="space-y-6">
      {/* Who and when */}
      <Card>
        <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Student</p>
            <p className="text-fg mt-1 text-base font-bold">{student.name}</p>
            <p className="text-fg-secondary text-sm">
              {student.studentNumber} · {student.departmentName} · enrolled {student.enrolmentYear}
            </p>
            <Link href="/admin/historical/import?tab=hand" className="text-brand-fg mt-1 inline-block text-xs font-medium hover:underline">
              Change student
            </Link>
          </div>
          <div>
            <Label htmlFor="me-year">Academic year</Label>
            <Select
              id="me-year"
              value={yearLabel}
              onChange={(e) => {
                touched();
                setYearLabel(e.target.value);
              }}
            >
              {years.map((y) => (
                <option key={y.label} value={y.label}>
                  {y.label}
                  {y.inCalendar ? "" : " (not in calendar yet)"}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-fg" id="me-sem-label">
              Semester
            </span>
            <div role="radiogroup" aria-labelledby="me-sem-label" className="grid grid-cols-2 gap-2">
              {([1, 2] as const).map((s) => {
                const info = year?.semesters.find((x) => x.sequence === s);
                const on = sequence === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      touched();
                      setSequence(s);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      on ? "border-brand bg-brand-subtle text-brand-fg" : "border-line-strong text-fg hover:bg-surface-hover",
                    )}
                  >
                    <span className="block font-semibold whitespace-nowrap">Semester {s === 1 ? "I" : "II"}</span>
                    <span className="text-fg-muted block text-xs">
                      {!info?.inCalendar
                        ? "Will be created"
                        : info.ended === false
                          ? "Not ended yet"
                          : info.grades
                            ? `${info.grades} grade${info.grades === 1 ? "" : "s"} on record`
                            : "No grades yet"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      {semInfo?.ended === false && (
        <Alert tone="warning">
          {yearLabel} — Semester {sequence === 1 ? "I" : "II"} has not ended yet. Past grades go only into semesters that are over;
          grades for a current class are entered on Grade entry.
        </Alert>
      )}

      {/* The courses */}
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
        </CardHeader>
        <CardBody>
          <datalist id="me-course-options">
            {courses.map((c) => (
              <option key={c.code} value={formatCourseCode(c.code)}>
                {c.title} ({c.creditHours} hrs)
              </option>
            ))}
          </datalist>

          <div className="text-fg-muted hidden grid-cols-[minmax(0,2.4fr)_5rem_7rem_5rem_7.5rem_2.5rem] gap-3 border-b border-line pb-2 text-xs font-semibold tracking-wide uppercase lg:grid">
            <span>Course</span>
            <span>Cr/Hrs</span>
            <span>Grade</span>
            <span className="text-right">Points</span>
            <span>Points on paper</span>
            <span className="sr-only">Remove</span>
          </div>

          <ol className="divide-line divide-y">
            {rows.map((r, i) => {
              const l = live[i];
              const unknown = r.code.trim() !== "" && !l.listed;
              return (
                <li key={r.key} className="py-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,2.4fr)_5rem_7rem_5rem_7.5rem_2.5rem] lg:items-start">
                    <div className="col-span-2 sm:col-span-4 lg:col-span-1">
                      <Label htmlFor={`me-code-${r.key}`} className="text-xs lg:sr-only">
                        Course {i + 1}
                      </Label>
                      <Input
                        id={`me-code-${r.key}`}
                        list="me-course-options"
                        value={r.code}
                        placeholder="Search code or title, e.g. ACCT 101"
                        autoComplete="off"
                        onChange={(e) => {
                          // Picking "ACCT 101 — Introduction…" from the list fills just the code.
                          const typed = e.target.value;
                          const hit = courses.find((c) => typed === `${formatCourseCode(c.code)} — ${c.title}`);
                          update(r.key, { code: hit ? formatCourseCode(hit.code) : typed });
                        }}
                      />
                      <p className={cn("mt-1 truncate text-xs", unknown ? "text-warning-fg" : "text-fg-muted")}>
                        {l.listed ? l.listed.title : unknown ? "Not in the catalogue" : " "}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor={`me-hours-${r.key}`} className="text-xs lg:sr-only">
                        Cr/Hrs
                      </Label>
                      <Input
                        id={`me-hours-${r.key}`}
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        value={r.hours}
                        onChange={(e) => update(r.key, { hours: e.target.value })}
                        className={cn(l.hoursDiffer && "border-warning-line bg-warning-surface")}
                      />
                      {l.hoursDiffer && <p className="text-warning-fg mt-1 text-xs">Catalogue: {l.listed!.creditHours}</p>}
                    </div>
                    <div>
                      <Label htmlFor={`me-grade-${r.key}`} className="text-xs lg:sr-only">
                        Grade
                      </Label>
                      <Select id={`me-grade-${r.key}`} value={r.letter} onChange={(e) => update(r.key, { letter: e.target.value })}>
                        <option value="">—</option>
                        {grades.map((g) => (
                          <option key={g.letter} value={g.letter}>
                            {g.letter}
                            {g.countsInGpa && g.gradePoint !== null ? ` (${g.gradePoint.toFixed(2)})` : " (not counted)"}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="lg:text-right">
                      <span className="text-fg-muted block text-xs lg:sr-only">Points</span>
                      <span className="text-fg block py-2.5 text-sm font-semibold tabular-nums">
                        {l.points !== null ? fmt(l.points) : l.g ? "—" : ""}
                      </span>
                    </div>
                    <div>
                      <Label htmlFor={`me-paper-${r.key}`} className="text-xs lg:sr-only">
                        Points on paper
                      </Label>
                      <div className="relative">
                        <Input
                          id={`me-paper-${r.key}`}
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          value={r.paper}
                          placeholder="optional"
                          onChange={(e) => update(r.key, { paper: e.target.value })}
                          className={cn(
                            "pr-8",
                            l.paperState === "off" && "border-danger-line bg-danger-surface",
                            l.paperState === "ok" && "border-success-line",
                          )}
                        />
                        {l.paperState === "ok" && (
                          <CheckCircle2 className="text-success-fg absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2" aria-label="Matches" />
                        )}
                        {l.paperState === "off" && (
                          <AlertTriangle className="text-danger-fg absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2" aria-label="Does not match" />
                        )}
                      </div>
                      {l.paperState === "off" && <p className="text-danger-fg mt-1 text-xs">Doesn&apos;t match</p>}
                    </div>
                    <div className="flex items-end lg:items-start">
                      <button
                        type="button"
                        onClick={() => {
                          touched();
                          setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow(student.departmentId)]));
                        }}
                        className="text-fg-muted hover:bg-surface-hover hover:text-danger-fg rounded-md p-2.5"
                        title="Remove this row"
                        aria-label={`Remove row ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {unknown && (
                    <div className="border-warning-line bg-warning-surface mt-3 rounded-lg border p-3">
                      <p className="text-warning-fg mb-2 text-xs font-semibold">
                        {formatCourseCode(r.code.replace(/\s+/g, "").toUpperCase())} is not in the catalogue. How should it be recorded?
                      </p>
                      <div className="mb-3 flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`me-mode-${r.key}`} checked={r.mode === "catalogue"} onChange={() => update(r.key, { mode: "catalogue" })} />
                          Add it to the catalogue
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`me-mode-${r.key}`} checked={r.mode === "asPrinted"} onChange={() => update(r.key, { mode: "asPrinted" })} />
                          Record as printed (older curriculum)
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`me-title-${r.key}`} className="text-xs">
                            Title {r.mode === "asPrinted" ? "as printed" : ""}
                          </Label>
                          <Input id={`me-title-${r.key}`} value={r.newTitle} onChange={(e) => update(r.key, { newTitle: e.target.value })} />
                        </div>
                        {r.mode === "catalogue" && (
                          <div>
                            <Label htmlFor={`me-dept-${r.key}`} className="text-xs">
                              Department
                            </Label>
                            <Select id={`me-dept-${r.key}`} value={r.newDept} onChange={(e) => update(r.key, { newDept: e.target.value })}>
                              {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                        )}
                      </div>
                      {r.mode === "catalogue" && <p className="text-fg-muted mt-2 text-xs">Added with the credit hours above, when you save.</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                touched();
                setRows((rs) => [...rs, blankRow(student.departmentId)]);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add row
            </Button>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <span className="text-fg-secondary">
                <strong className="text-fg tabular-nums">{fmt(gpaHours)}</strong> hrs counted ·{" "}
                <strong className="text-fg tabular-nums">{fmt(Number(totalPoints.toFixed(2)))}</strong> points
              </span>
              <span className="text-fg text-base font-bold">GPA {gpa !== null ? gpa.toFixed(2) : "—"}</span>
              <span className="flex items-center gap-2">
                <Label htmlFor="me-paper-gpa" className="mb-0 text-xs whitespace-nowrap">
                  GPA on paper
                </Label>
                <span className="w-24">
                  <Input
                    id="me-paper-gpa"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="4"
                    value={paperGpa}
                    placeholder="optional"
                    onChange={(e) => {
                      touched();
                      setPaperGpa(e.target.value);
                    }}
                    className={cn(paperGpaNum !== null && gpa !== null && Math.abs(paperGpaNum - gpa) > 0.001 && "border-danger-line bg-danger-surface")}
                  />
                </span>
                {paperGpaNum !== null && gpa !== null && (Math.abs(paperGpaNum - gpa) > 0.001 ? (
                  <Badge tone="danger">Doesn&apos;t match</Badge>
                ) : (
                  <Badge tone="success">Matches</Badge>
                ))}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Check, then save */}
      {!check ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runCheck} disabled={pending || filled === 0 || !yearLabel} className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            {pending ? "Checking…" : "Check before saving"}
          </Button>
          <span className="text-fg-muted text-xs">Nothing is saved until you have checked and confirmed.</span>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Check</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm">
              <strong>{check.student.name}</strong> ({check.student.studentNumber}) — <strong>{check.semester.label}</strong>
            </p>
            {check.semester.willCreate && <Alert tone="info">{check.semester.willCreate}</Alert>}
            {check.semester.onRecord.length > 0 && (
              <p className="text-fg-secondary text-sm">
                Already on record for this semester:{" "}
                {check.semester.onRecord.map((r) => `${r.code} (${r.letter})`).join(", ")}. The courses below are added to them.
              </p>
            )}

            <ul className="divide-line border-line divide-y rounded-lg border text-sm">
              {check.rows.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
                  <span className="text-fg font-semibold whitespace-nowrap">{r.code}</span>
                  <span className="text-fg min-w-0 flex-1">{r.title}</span>
                  {r.catalogue === "adding" && <Badge tone="brand">Adding to catalogue</Badge>}
                  {r.catalogue === "asPrinted" && <Badge tone="warning">As printed</Badge>}
                  <span className="tabular-nums whitespace-nowrap">
                    {fmt(r.creditHours)} hrs · {r.letter} · {r.points !== null ? `${fmt(r.points)} pts` : "not counted"}
                  </span>
                  {r.problems.map((p) => (
                    <span key={p} className="text-danger-fg basis-full text-xs">
                      {p}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Semester GPA: <strong>{check.totals.gpa !== null ? check.totals.gpa.toFixed(2) : "—"}</strong> ({fmt(check.totals.points)} points /{" "}
              {fmt(check.totals.gpaHours)} hours counted)
            </p>

            {check.problems.length > 0 ? (
              <Alert tone="danger">
                <p className="font-semibold">Fix these first — nothing has been saved:</p>
                <ul className="mt-1 list-disc pl-5">
                  {check.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <>
                {check.toConfirm.length > 0 && (
                  <Alert tone="warning">
                    <p className="font-semibold">Check these against the paper sheet:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {check.toConfirm.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    <label className="mt-3 flex items-start gap-2 font-medium">
                      <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      I have checked these against the paper sheet, and the grades and hours above are right.
                    </label>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={runSave} disabled={pending || (check.toConfirm.length > 0 && !confirmed)}>
                    {pending ? "Saving…" : `Save ${check.rows.length} grade${check.rows.length === 1 ? "" : "s"}`}
                  </Button>
                  <Button variant="secondary" onClick={() => setCheck(null)} disabled={pending}>
                    Back to editing
                  </Button>
                </div>
              </>
            )}
            {check.problems.length > 0 && (
              <Button variant="secondary" onClick={() => setCheck(null)}>
                Back to editing
              </Button>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
