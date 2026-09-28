"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { formatCourseCode } from "@/lib/courses/courseCode";
import { csvCell } from "@/lib/export/csvCell";
import type { ImportAnalysis, ImportSheet } from "@/lib/historical/gradeSheetImportCore";
import type { CommitGradeSheetResult } from "@/lib/historical/gradeSheetImport";
import { commitGradeSheetImportAction, previewGradeSheetImportAction } from "./actions";

/**
 * Choose the file, check it, then import what passed.
 *
 * Nothing is written until the second button, and that button imports only
 * the sheets the check passed. The server checks the whole file again at
 * that moment rather than trusting this screen. The held-back list can be
 * downloaded, so it can be worked through against the paper sheets and the
 * corrected file checked again.
 */
export default function GradeSheetImportForm() {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [result, setResult] = useState<CommitGradeSheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [confirmRepeats, setConfirmRepeats] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setAnalysis(null);
    setResult(null);
    setError(null);
    setChecked(false);
    setConfirmRepeats(false);
  };

  const onFile = async (file: File | undefined) => {
    reset();
    setFileName(file?.name ?? "");
    setText(file ? await file.text() : "");
  };

  const runCheck = () => {
    reset();
    startTransition(async () => {
      const outcome = await previewGradeSheetImportAction(text);
      if (!outcome.ok) setError(outcome.error);
      else if (outcome.analysis.fileProblem) setError(outcome.analysis.fileProblem);
      else setAnalysis(outcome.analysis);
    });
  };

  const runImport = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await commitGradeSheetImportAction(text, fileName, confirmRepeats);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setResult(outcome.result);
      setAnalysis(null);
      setChecked(false);
      setConfirmRepeats(false);
    });
  };

  const ready = analysis?.sheets.filter((s) => s.status === "ready") ?? [];
  const blocked = analysis?.sheets.filter((s) => s.status === "blocked") ?? [];
  const withRepeats = ready.filter((s) => s.courses.some((c) => c.repeatOf));
  const readyCourses = ready.reduce((n, s) => n + s.courses.length, 0);
  const canImport = ready.length > 0 && checked && (withRepeats.length === 0 || confirmRepeats);

  return (
    <>
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {result && (
        <Alert tone={result.imported.length > 0 && result.failed.length === 0 ? "success" : "warning"} className="mb-6">
          <p className="font-semibold">
            {result.imported.length} sheet{result.imported.length === 1 ? "" : "s"} imported (
            {result.imported.reduce((n, s) => n + s.courses, 0)} courses).
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
            {result.blocked > 0 && <li>{result.blocked} held back by the check. Nothing from them was imported.</li>}
            {result.heldForRepeats.length > 0 && (
              <li>{result.heldForRepeats.length} not imported, because the repeated courses on them were not confirmed.</li>
            )}
            {result.failed.map((f) => (
              <li key={f.sheet}>
                {f.sheet}: not imported. {f.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle icon={<FileUp className="h-4 w-4" aria-hidden="true" />}>Choose the grade-sheet file</CardTitle>
        </CardHeader>
        <CardBody>
          <Label htmlFor="grade-sheet-file" className="text-xs">
            A CSV with one row per course, in the grade-sheet extraction format
          </Label>
          <input
            id="grade-sheet-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-fg file:border-line file:bg-surface-subtle file:text-fg mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-2 file:text-sm file:font-semibold"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={runCheck} disabled={pending || !text}>
              {pending && !analysis ? "Checking…" : "Check the file"}
            </Button>
            <p className="text-fg-muted text-xs">This only reads the file. Nothing is saved.</p>
          </div>
        </CardBody>
      </Card>

      {analysis && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Sheets in the file" value={analysis.sheets.length} hint={`${analysis.rowCount} rows`} />
            <Stat label="Ready to import" value={ready.length} hint={`${readyCourses} courses`} tone="success" />
            <Stat label="Held back" value={blocked.length} hint="Nothing from these is imported" tone={blocked.length ? "warning" : undefined} />
          </div>

          {blocked.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>Held back ({blocked.length})</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={() => downloadProblems(blocked, fileName)}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download this list
                </Button>
              </CardHeader>
              <CardBody>
                <p className="text-fg-secondary mb-4 text-sm">
                  Check each problem against the paper grade sheet, correct the file, and check it again. A sheet is
                  imported whole or not at all.
                </p>
                <ul className="flex flex-col gap-4">
                  {blocked.map((s) => (
                    <li key={s.key} className="border-line-subtle border-b pb-4 last:border-0 last:pb-0">
                      <SheetHeading sheet={s} />
                      <ul className="text-danger-fg mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm">
                        {s.problems.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>Ready to import ({ready.length})</CardTitle>
            </CardHeader>
            {ready.length === 0 ? (
              <CardBody>
                <p className="text-fg-muted text-sm">No sheet in this file passed every check yet.</p>
              </CardBody>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th className="text-left">Student</Th>
                    <Th className="text-left">Semester</Th>
                    <Th className="text-left">Courses</Th>
                    <Th className="text-right">GPA</Th>
                    <Th className="text-left">From</Th>
                  </tr>
                </Thead>
                <tbody>
                  {ready.map((s) => (
                    <Tr key={s.key}>
                      <Td>
                        <span className="text-fg font-semibold">{s.student?.name}</span>
                        <span className="text-fg-muted block text-xs tabular-nums">{s.studentNumber}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{s.semester?.label}</Td>
                      <Td>
                        <ul className="flex flex-col gap-0.5 text-sm">
                          {s.courses.map((c) => (
                            <li key={c.line}>
                              <span className="tabular-nums">{formatCourseCode(c.code)}</span>{" "}
                              <span className="text-fg-muted">{c.title}</span> — <strong>{c.letter}</strong>, {c.creditHours} hr
                              {c.creditHours === 1 ? "" : "s"}
                              {c.repeatOf && (
                                <Badge tone="warning" className="ml-2">
                                  Repeat: {c.repeatOf}
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Td>
                      <Td className="text-right tabular-nums">{s.computedGpa ?? "—"}</Td>
                      <Td className="text-fg-muted text-xs">
                        {s.sourceFile}
                        <br />
                        page {s.page}, sheet {s.sheetNo} · lines {s.lines}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {ready.length > 0 && (
            <Card className="mb-6">
              <CardBody className="flex flex-col gap-3">
                {withRepeats.length > 0 && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={confirmRepeats} onChange={(e) => setConfirmRepeats(e.target.checked)} />
                    <span>
                      {withRepeats.length} of these sheet{withRepeats.length === 1 ? " has" : "s have"} a course the student
                      also took in another semester (marked <strong>Repeat</strong> above). I confirm the student really
                      took each of them again. Only the latest attempt will count in CGPA.
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <span>
                    I have checked these {ready.length} sheet{ready.length === 1 ? "" : "s"} against the paper grade sheets.
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={runImport} disabled={pending || !canImport}>
                    {pending ? "Importing…" : `Import ${ready.length} sheet${ready.length === 1 ? "" : "s"} (${readyCourses} courses)`}
                  </Button>
                  <p className="text-fg-muted text-xs">
                    Held-back sheets are not touched. Every imported course is recorded in the audit log.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function SheetHeading({ sheet }: { sheet: ImportSheet }) {
  return (
    <p className="text-sm">
      <span className="text-fg font-semibold">{sheet.nameOnSheet || "(no name on sheet)"}</span>
      <span className="text-fg-muted"> · ID {sheet.studentNumber || "—"}</span>
      {sheet.semester && <span className="text-fg-muted"> · {sheet.semester.label}</span>}
      <span className="text-fg-muted block text-xs">
        {sheet.sourceFile}, page {sheet.page}, sheet {sheet.sheetNo} · CSV lines {sheet.lines}
      </span>
    </p>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "success" | "warning" }) {
  return (
    <div className="border-line bg-surface shadow-card rounded-2xl border p-4">
      <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p
        className={
          tone === "success" ? "text-success-fg mt-1 text-3xl font-extrabold tabular-nums" : tone === "warning" ? "text-warning-fg mt-1 text-3xl font-extrabold tabular-nums" : "text-fg mt-1 text-3xl font-extrabold tabular-nums"
        }
      >
        {value}
      </p>
      <p className="text-fg-muted mt-0.5 text-xs">{hint}</p>
    </div>
  );
}

/** The held-back list as a spreadsheet, one row per problem. */
function downloadProblems(sheets: ImportSheet[], fileName: string) {
  // csvCell quotes and also neutralises a value starting with = + - @, so
  // a name typed that way cannot run as a formula when the list is opened.
  const lines = [["source_file", "page", "sheet_no", "csv_lines", "student_id", "name_on_sheet", "semester", "problem"].join(",")];
  for (const s of sheets)
    for (const p of s.problems)
      lines.push(
        [s.sourceFile, s.page, s.sheetNo, s.lines, s.studentNumber, s.nameOnSheet, s.semester?.label ?? "", p].map((v) => csvCell(v)).join(","),
      );
  const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `held-back-${fileName.replace(/\.csv$/i, "") || "grade-sheets"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
