"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ClipboardCheck, Plus, Trash2, Undo2 } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Form";
import { cn } from "@/components/ui/cn";
import { courseCodeKey, formatCourseCode } from "@/lib/courses/courseCode";
import type { SemesterEditCheck, SemesterEditResult } from "@/lib/historical/semesterEdit";
import { checkSemesterEditAction, saveSemesterEditAction } from "./actions";

export interface SemesterEditFormProps {
  student: { id: string; name: string; studentNumber: string; departmentId: string };
  semester: { id: string; label: string };
  initialRows: Array<{ recordId: string; code: string; title: string; hours: string; letter: string; inCatalogue: boolean }>;
  locked: Array<{ code: string; title: string; letter: string; creditHours: string }>;
  courses: Array<{ code: string; title: string; creditHours: number }>;
  departments: Array<{ id: string; name: string; isActive: boolean; collegeName: string }>;
  grades: Array<{ letter: string; gradePoint: number | null; countsInGpa: boolean }>;
}

interface Row {
  key: number;
  recordId?: string;
  originalCode: string;
  code: string;
  title: string;
  hours: string;
  hoursAuto: boolean;
  letter: string;
  removed: boolean;
  mode: "catalogue" | "asPrinted";
  newTitle: string;
  newDept: string;
}

let nextKey = 1;
const blank = (dept: string): Row => ({
  key: nextKey++, originalCode: "", code: "", title: "", hours: "", hoursAuto: false, letter: "", removed: false,
  mode: "catalogue", newTitle: "", newDept: dept,
});

const gpa = (n: number | null) => (n === null ? "—" : n.toFixed(2));
const KIND_TONE = { added: "success", changed: "info", removed: "danger", unchanged: "neutral" } as const;

/**
 * One past semester, editable the way it was entered. Every imported grade
 * is a row that can be changed or taken out; a row can be added; a course the
 * catalogue lacks can be added to it or kept as printed. "Check" asks the
 * server what saving would change and what the GPA becomes; "Save" does it
 * all at once, with one reason.
 */
export default function SemesterEditForm({ student, semester, initialRows, locked, courses, departments, grades }: SemesterEditFormProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialRows.map((r) => ({
      key: nextKey++, recordId: r.recordId, originalCode: r.code, code: r.code, title: r.title, hours: r.hours,
      hoursAuto: false, letter: r.letter, removed: false, mode: "catalogue", newTitle: r.inCatalogue ? "" : r.title, newDept: student.departmentId,
    })),
  );
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<SemesterEditCheck | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<SemesterEditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const catalogue = useMemo(() => new Map(courses.map((c) => [courseCodeKey(c.code), c])), [courses]);
  const collegeGroups = useMemo(() => {
    const groups = new Map<string, typeof departments>();
    for (const d of departments) groups.set(d.collegeName, [...(groups.get(d.collegeName) ?? []), d]);
    return [...groups];
  }, [departments]);

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
          if (listed && (r.hoursAuto || r.hours === "" || courseCodeKey(patch.code) !== courseCodeKey(r.originalCode))) {
            next.hours = String(listed.creditHours);
            next.hoursAuto = true;
          }
        }
        if (patch.hours !== undefined) next.hoursAuto = false;
        return next;
      }),
    );
  };

  const kept = rows.filter((r) => !r.removed && (r.code.trim() || r.letter));
  const payload = (withConfirm: boolean) => ({
    studentId: student.id,
    semesterId: semester.id,
    reason,
    confirmed: withConfirm,
    rows: kept.map((r) => {
      const listed = catalogue.get(courseCodeKey(r.code));
      return {
        recordId: r.recordId,
        code: r.code,
        creditHours: Number(r.hours),
        letter: r.letter,
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
      const out = await checkSemesterEditAction(payload(false));
      if (!out.ok) setError(out.error);
      else setCheck(out.check);
    });
  };
  const runSave = () => {
    setError(null);
    startTransition(async () => {
      const out = await saveSemesterEditAction(payload(confirmed));
      if (!out.ok) setError(out.error);
      else {
        setSaved(out.result);
        setCheck(null);
      }
    });
  };

  if (saved) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success">
            <p className="font-semibold">
              Saved {saved.semester} for {student.name} ({student.studentNumber}).
            </p>
            <p className="mt-1">
              {saved.changed} changed, {saved.added} added, {saved.removed} removed. The GPA and CGPA were recalculated.
            </p>
            {saved.createdCourses.length > 0 && (
              <p className="mt-1">
                Added to the catalogue: {saved.createdCourses.join("; ")}.{" "}
                <Link href={`/admin/structure?courseQ=${encodeURIComponent(saved.createdCourseCodes[0] ?? "")}#courses`} className="font-medium underline">
                  See {saved.createdCourses.length === 1 ? "it" : "them"} in Academic structure
                </Link>
                .
              </p>
            )}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/historical?studentId=${student.id}`} className={buttonClasses("primary")}>
              Back to past record
            </Link>
            <Link href={`/admin/students/${student.id}`} className={buttonClasses("secondary")}>
              Open profile
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Editing</p>
          <p className="text-fg mt-1 text-base font-bold">{semester.label}</p>
          <p className="text-fg-secondary text-sm">
            {student.name} · {student.studentNumber}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
        </CardHeader>
        <CardBody>
          <datalist id="se-course-options">
            {courses.map((c) => (
              <option key={c.code} value={formatCourseCode(c.code)}>
                {c.title} ({c.creditHours} hrs)
              </option>
            ))}
          </datalist>

          <div className="text-fg-muted hidden grid-cols-[minmax(0,2.4fr)_5rem_8rem_2.5rem] gap-3 border-b border-line pb-2 text-xs font-semibold tracking-wide uppercase lg:grid">
            <span>Course</span>
            <span>Cr/Hrs</span>
            <span>Grade</span>
            <span className="sr-only">Remove</span>
          </div>

          <ol className="divide-line divide-y">
            {rows.map((r, i) => {
              const listed = r.code.trim() ? catalogue.get(courseCodeKey(r.code)) : undefined;
              const codeChanged = r.recordId ? courseCodeKey(r.code) !== courseCodeKey(r.originalCode) : true;
              const unknown = r.code.trim() !== "" && !listed && codeChanged;
              return (
                <li key={r.key} className={cn("py-3", r.removed && "opacity-60")}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,2.4fr)_5rem_8rem_2.5rem] lg:items-start">
                    <div className="col-span-2 sm:col-span-3 lg:col-span-1">
                      <Label htmlFor={`se-code-${r.key}`} className="text-xs lg:sr-only">
                        Course {i + 1}
                      </Label>
                      <Input
                        id={`se-code-${r.key}`}
                        list="se-course-options"
                        value={r.code}
                        disabled={r.removed}
                        placeholder="Search code or title, e.g. ACCT 101"
                        autoComplete="off"
                        className={cn(r.removed && "line-through")}
                        onChange={(e) => {
                          const typed = e.target.value;
                          const hit = courses.find((c) => typed === `${formatCourseCode(c.code)} — ${c.title}`);
                          update(r.key, { code: hit ? formatCourseCode(hit.code) : typed });
                        }}
                      />
                      <p className={cn("mt-1 truncate text-xs", unknown ? "text-warning-fg" : "text-fg-muted")}>
                        {r.removed ? "Will be removed" : listed ? listed.title : unknown ? "Not in the catalogue" : r.title || " "}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor={`se-hours-${r.key}`} className="text-xs lg:sr-only">
                        Cr/Hrs
                      </Label>
                      <Input
                        id={`se-hours-${r.key}`}
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        value={r.hours}
                        disabled={r.removed}
                        onChange={(e) => update(r.key, { hours: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`se-grade-${r.key}`} className="text-xs lg:sr-only">
                        Grade
                      </Label>
                      <Select id={`se-grade-${r.key}`} value={r.letter} disabled={r.removed} onChange={(e) => update(r.key, { letter: e.target.value })}>
                        <option value="">—</option>
                        {grades.map((g) => (
                          <option key={g.letter} value={g.letter}>
                            {g.letter}
                            {g.countsInGpa && g.gradePoint !== null ? ` (${g.gradePoint.toFixed(2)})` : " (not counted)"}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex items-end lg:items-start">
                      {r.removed ? (
                        <button
                          type="button"
                          onClick={() => update(r.key, { removed: false })}
                          className="text-fg-muted hover:bg-surface-hover hover:text-brand-fg rounded-md p-2.5"
                          title="Keep this grade after all"
                          aria-label={`Keep row ${i + 1}`}
                        >
                          <Undo2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            touched();
                            // An existing grade is marked for removal; a row added just now is dropped.
                            setRows((rs) => (r.recordId ? rs.map((x) => (x.key === r.key ? { ...x, removed: true } : x)) : rs.filter((x) => x.key !== r.key)));
                          }}
                          className="text-fg-muted hover:bg-surface-hover hover:text-danger-fg rounded-md p-2.5"
                          title="Remove this grade"
                          aria-label={`Remove row ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  {unknown && !r.removed && (
                    <div className="border-warning-line bg-warning-surface mt-3 rounded-lg border p-3">
                      <p className="text-fg mb-2 text-sm font-semibold">{formatCourseCode(r.code.trim().toUpperCase())} is not in the catalogue.</p>
                      <div className="mb-3 flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`se-mode-${r.key}`} checked={r.mode === "catalogue"} onChange={() => update(r.key, { mode: "catalogue" })} />
                          Add it to the catalogue
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`se-mode-${r.key}`} checked={r.mode === "asPrinted"} onChange={() => update(r.key, { mode: "asPrinted" })} />
                          Record as printed (older curriculum)
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`se-title-${r.key}`} className="text-xs">
                            Title {r.mode === "asPrinted" ? "as printed" : ""}
                          </Label>
                          <Input id={`se-title-${r.key}`} value={r.newTitle} onChange={(e) => update(r.key, { newTitle: e.target.value })} />
                        </div>
                        {r.mode === "catalogue" && (
                          <div>
                            <Label htmlFor={`se-dept-${r.key}`} className="text-xs">
                              Department
                            </Label>
                            <Select id={`se-dept-${r.key}`} value={r.newDept} onChange={(e) => update(r.key, { newDept: e.target.value })}>
                              {collegeGroups.map(([college, list]) => (
                                <optgroup key={college} label={college}>
                                  {list.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                      {d.isActive ? "" : " (inactive)"}
                                    </option>
                                  ))}
                                </optgroup>
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

          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => {
                touched();
                setRows((rs) => [...rs, blank(student.departmentId)]);
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add row
            </Button>
          </div>

          {locked.length > 0 && (
            <div className="mt-5">
              <p className="text-fg-muted mb-1 text-xs font-semibold tracking-wide uppercase">From the system (not editable here)</p>
              <ul className="text-fg-secondary text-sm">
                {locked.map((l) => (
                  <li key={l.code}>
                    {l.code} — {l.title}: {l.letter} ({l.creditHours} hrs)
                  </li>
                ))}
              </ul>
              <p className="text-fg-muted mt-1 text-xs">These were published through grade entry; change them from Grade corrections.</p>
            </div>
          )}
        </CardBody>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {check && (
        <Card>
          <CardHeader>
            <CardTitle>Check</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {check.problems.length > 0 && (
              <Alert tone="danger">
                <p className="font-semibold">Fix these before saving:</p>
                <ul className="mt-1 list-disc pl-5">
                  {check.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {check.unchanged && check.problems.length === 0 && <Alert tone="info">Nothing has changed, so there is nothing to save.</Alert>}
            {check.changes.some((c) => c.kind !== "unchanged") && (
              <ul className="divide-line divide-y text-sm">
                {check.changes
                  .filter((c) => c.kind !== "unchanged")
                  .map((c, i) => (
                    <li key={`${c.code}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                      <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge>
                      <span className="font-medium">{c.code}</span>
                      <span className="text-fg-secondary">{c.title}</span>
                      <span className="text-fg-muted ml-auto text-xs">
                        {c.detail}
                        {c.kind === "added" && c.after ? ` — ${c.after.letter}, ${c.after.creditHours} hrs` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {check.newCourses.length > 0 && <p className="text-sm">Added to the catalogue when you save: {check.newCourses.join("; ")}.</p>}
            {!check.unchanged && check.problems.length === 0 && (
              <div className="bg-surface-subtle grid gap-3 rounded-lg p-3 text-sm sm:grid-cols-2">
                <p>
                  Semester GPA: <strong>{gpa(check.summary.before.semesterGpa)}</strong> → <strong>{gpa(check.summary.after.semesterGpa)}</strong>
                </p>
                <p>
                  CGPA: <strong>{gpa(check.summary.before.cgpa)}</strong> → <strong>{gpa(check.summary.after.cgpa)}</strong>
                  <span className="text-fg-muted"> ({check.summary.before.credits} → {check.summary.after.credits} credits earned)</span>
                </p>
              </div>
            )}
            {check.toConfirm.length > 0 && check.problems.length === 0 && (
              <Alert tone="warning">
                <ul className="list-disc pl-5">
                  {check.toConfirm.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I have checked these against the paper sheet.
                </label>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {!check.unchanged && check.problems.length === 0 && (
                <Button onClick={runSave} disabled={pending || (check.toConfirm.length > 0 && !confirmed)}>
                  {pending ? "Saving…" : "Save changes"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setCheck(null)} disabled={pending}>
                Back to editing
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {!check && (
        <Card>
          <CardBody className="space-y-3">
            <div>
              <Label htmlFor="se-reason">Reason for the change (kept in the audit log)</Label>
              <Input
                id="se-reason"
                value={reason}
                onChange={(e) => {
                  touched();
                  setReason(e.target.value);
                }}
                placeholder="e.g. Grades re-entered from the original paper sheet"
                maxLength={500}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={runCheck} disabled={pending} className="gap-1.5">
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                {pending ? "Checking…" : "Check before saving"}
              </Button>
              <p className="text-fg-muted text-xs">Nothing is saved until you have checked and confirmed. Removed grades are kept in the record as voided.</p>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
