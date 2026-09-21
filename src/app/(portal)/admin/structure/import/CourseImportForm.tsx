"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardPaste, Upload } from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Label, Select, Textarea } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { formatCourseCode } from "@/lib/courses/courseCode";
import type { ImportPreview, ImportResult } from "@/lib/courses/courseImport";
import { commitCourseImportAction, previewCourseImportAction } from "./actions";

export interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Paste, check, import.
 *
 * A client component for one reason: the paste is the state, and at eight
 * hundred courses it is far too big to carry through a redirect the way
 * every other form on this site does. So it stays in the browser between
 * the preview and the commit, and the server keeps no half-finished
 * import at all.
 *
 * The shape of the screen follows the shape of the risk. Nothing is
 * written until the second button, the preview says exactly what each row
 * will do, and every subject needs a department chosen for it before its
 * courses go anywhere -- 800 rows is far past the point where anyone
 * would notice a wrong default.
 */
export default function CourseImportForm({ departments }: { departments: DepartmentOption[] }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runPreview = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const outcome = await previewCourseImportAction(text);
      if (!outcome.ok) {
        setError(outcome.error);
        setPreview(null);
        return;
      }
      setPreview(outcome.preview);
      // Where a department's code IS the subject prefix, offer it -- but
      // only as a starting point the Admin can see and change.
      setMapping(
        Object.fromEntries(outcome.preview.prefixes.map((p) => [p.prefix, p.suggestedDepartmentId ?? ""])),
      );
    });
  };

  const runImport = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await commitCourseImportAction(text, mapping);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setResult(outcome.result);
      setPreview(null);
    });
  };

  const mappedCount = preview?.prefixes.filter((p) => mapping[p.prefix]).length ?? 0;
  const willCreate =
    preview?.rows.filter((r) => !r.existing && mapping[r.prefix]).length ?? 0;

  return (
    <>
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {result && (
        <Alert tone={result.created > 0 ? "success" : "info"} className="mb-6">
          <p className="font-semibold">
            {result.created} course{result.created === 1 ? "" : "s"} added to the catalogue.
          </p>
          {/* A number for every row. An 800-row operation that reports only
              its successes leaves nobody able to say what happened. */}
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
            {result.skippedExisting > 0 && <li>{result.skippedExisting} were already on record and were left alone.</li>}
            {result.skippedUnmapped > 0 && (
              <li>{result.skippedUnmapped} were skipped because their subject had no department chosen.</li>
            )}
            {result.failed.map((f) => (
              <li key={f.code}>
                {formatCourseCode(f.code)} — {f.reason}
              </li>
            ))}
          </ul>
          <Link href="/admin/structure#courses" className="mt-2 inline-block font-medium underline">
            See them on Academic structure
          </Link>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle icon={<ClipboardPaste className="h-4 w-4" aria-hidden="true" />}>Paste the course list</CardTitle>
        </CardHeader>
        <CardBody>
          <Label htmlFor="course-paste" className="text-xs">
            One course per line, as <span className="font-mono">CODE | TITLE | CREDITS</span>
          </Label>
          <Textarea
            id="course-paste"
            rows={10}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            placeholder={"ACCT101 | Introduction to Financial Accounting I | 3\nENGL101 | Freshman English I | 3"}
            className="font-mono text-xs"
          />
          <p className="text-fg-muted mt-2 text-xs">
            Line breaks in the wrong places are fine — text copied out of a PDF breaks mid-title and this reads it
            anyway. A <span className="font-mono">CONFLICTS</span> or <span className="font-mono">NEEDS ATTENTION</span>{" "}
            heading ends the list, so you can paste the whole file.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={runPreview} disabled={pending || !text.trim()}>
              {pending && !preview ? "Reading…" : "Check the list"}
            </Button>
            <p className="text-fg-muted text-xs">Nothing is saved by this. It only reads.</p>
          </div>
        </CardBody>
      </Card>

      {preview && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>What is in the list</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-line-subtle border-line-subtle grid grid-cols-2 divide-x rounded-xl border sm:grid-cols-3">
                <Figure term="Courses read" value={preview.totals.parsed} />
                <Figure term="New to us" value={preview.totals.newToUs} tone="brand" />
                <Figure term="Already on record" value={preview.totals.alreadyOnRecord} />
              </dl>

              {preview.problems.length > 0 && (
                <div className="border-warning-line bg-warning-surface mt-4 rounded-xl border p-3">
                  <p className="text-warning-fg flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {preview.problems.length} line{preview.problems.length === 1 ? "" : "s"} could not be read
                  </p>
                  <ul className="text-fg-secondary mt-1 flex flex-col gap-0.5 font-mono text-xs">
                    {preview.problems.slice(0, 10).map((p, i) => (
                      <li key={i}>{p.text}</li>
                    ))}
                  </ul>
                  {preview.problems.length > 10 && (
                    <p className="text-fg-muted mt-1 text-xs">…and {preview.problems.length - 10} more.</p>
                  )}
                  <p className="text-fg-secondary mt-2 text-xs">
                    These are not imported. Fix them in the list and check again, or import the rest and add them by
                    hand.
                  </p>
                </div>
              )}

              {preview.duplicates.length > 0 && (
                <div className="border-warning-line bg-warning-surface mt-4 rounded-xl border p-3">
                  <p className="text-warning-fg text-sm font-semibold">
                    {preview.duplicates.length} code{preview.duplicates.length === 1 ? " appears" : "s appear"} more than
                    once
                  </p>
                  <ul className="text-fg-secondary mt-1 flex flex-col gap-0.5 text-xs">
                    {preview.duplicates.slice(0, 10).map((d) => (
                      <li key={d.code}>
                        <span className="text-fg font-mono font-bold">{formatCourseCode(d.code)}</span> — keeping “
                        {d.keptTitle}”, ignoring “{d.alsoSeenTitles.join("”, “")}”
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="mb-6 overflow-hidden">
            <div className="border-line-subtle border-b px-4 py-4 sm:px-5">
              <h2 className="text-fg text-sm font-semibold">Which department does each subject belong to?</h2>
              <p className="text-fg-muted mt-0.5 text-xs">
                {mappedCount} of {preview.prefixes.length} chosen. A subject left unchosen has its courses skipped —
                nothing is guessed. Missing a department?{" "}
                <Link href="/admin/structure" className="text-brand-fg font-medium hover:underline">
                  Add it on Academic structure
                </Link>{" "}
                and check the list again.
              </p>
            </div>
            <Table>
              <Thead>
                <tr>
                  <Th className="whitespace-nowrap">Subject</Th>
                  <Th className="whitespace-nowrap">Courses</Th>
                  <Th>Department</Th>
                </tr>
              </Thead>
              <tbody>
                {preview.prefixes.map((p) => (
                  <Tr key={p.prefix}>
                    <Td className="text-fg font-mono text-xs font-bold whitespace-nowrap">{p.prefix}</Td>
                    <Td className="whitespace-nowrap">{p.count}</Td>
                    <Td>
                      <Select
                        aria-label={`Department for ${p.prefix}`}
                        value={mapping[p.prefix] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [p.prefix]: e.target.value }))}
                      >
                        <option value="">Skip these courses</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.code} — {d.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card className="mb-6 overflow-hidden">
            <div className="border-line-subtle border-b px-4 py-4 sm:px-5">
              <h2 className="text-fg text-sm font-semibold">Every row, and what will happen to it</h2>
            </div>
            <div className="max-h-[28rem] overflow-y-auto">
              <Table>
                <Thead>
                  <tr>
                    <Th className="whitespace-nowrap">Code</Th>
                    <Th>Title</Th>
                    <Th className="whitespace-nowrap">Cr/Hrs</Th>
                    <Th className="whitespace-nowrap">Outcome</Th>
                  </tr>
                </Thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <Tr key={r.code}>
                      <Td className="text-fg font-mono text-xs font-bold whitespace-nowrap">
                        {formatCourseCode(r.code)}
                      </Td>
                      <Td className="text-fg">{r.title}</Td>
                      <Td className="whitespace-nowrap">{r.creditHours}</Td>
                      <Td className="whitespace-nowrap">
                        {r.existing ? (
                          <Badge tone="neutral">Already on record</Badge>
                        ) : mapping[r.prefix] ? (
                          <Badge tone="success">Will be added</Badge>
                        ) : (
                          <Badge tone="warning">Skipped — no department</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardBody className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={runImport} disabled={pending || willCreate === 0}>
                {pending ? (
                  "Importing…"
                ) : (
                  <>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Import {willCreate} course{willCreate === 1 ? "" : "s"}
                  </>
                )}
              </Button>
              <p className="text-fg-muted text-xs">
                {willCreate === 0
                  ? "Nothing to import yet — choose a department for at least one subject."
                  : "All of them at once, or none. A course already on record is never overwritten."}
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

function Figure({ term, value, tone }: { term: string; value: number; tone?: "brand" }) {
  return (
    <div className="px-3 py-3 text-center">
      <dt className="text-fg-muted text-[11px] font-semibold tracking-wide uppercase">{term}</dt>
      <dd className={tone === "brand" ? "text-brand-fg mt-0.5 text-xl font-extrabold" : "text-fg mt-0.5 text-xl font-bold"}>
        {value}
      </dd>
    </div>
  );
}
