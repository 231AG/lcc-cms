"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Printer, RotateCcw } from "lucide-react";
import type { IssueLoginSlipsResult, LoginSlipStudent } from "@/lib/identity/loginSlips";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Form";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { LoginSlipSheet } from "./LoginSlipSheet";
import { issueLoginSlipsAction } from "./actions";

type Tab = "pending" | "changed";

const issuedDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Monrovia" }) : "—";

/**
 * The two lists and the print. The new passwords live only in this
 * component's state, for the print: "Done" drops them, and leaving the page
 * with them unprinted asks first.
 */
export function LoginSlipsManager({ students, maxPerPrint }: { students: LoginSlipStudent[]; maxPerPrint: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [dept, setDept] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [result, setResult] = useState<IssueLoginSlipsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const departments = useMemo(() => [...new Set(students.map((s) => s.departmentName))].sort(), [students]);
  const counts = useMemo(
    () => ({ pending: students.filter((s) => !s.passwordChanged).length, changed: students.filter((s) => s.passwordChanged).length }),
    [students],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter(
      (s) =>
        s.passwordChanged === (tab === "changed") &&
        (!dept || s.departmentName === dept) &&
        (!q || s.studentNumber.toLowerCase().includes(q) || s.sortName.toLowerCase().includes(q)),
    );
  }, [students, tab, dept, query]);
  const byId = useMemo(() => new Map(students.map((s) => [s.studentId, s])), [students]);

  // Passwords on screen and not yet dealt with: ask before the page is left.
  useEffect(() => {
    if (!result?.slips.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [result]);

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.studentId));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((s) => next.delete(s.studentId));
      else visible.forEach((s) => next.add(s.studentId));
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedPending = [...selected].filter((id) => byId.get(id) && !byId.get(id)!.passwordChanged);

  const issue = (ids: string[]) => {
    setError(null);
    startTransition(async () => {
      const outcome = await issueLoginSlipsAction(ids);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setConfirming(null);
      setSelected(new Set());
      setResult(outcome.result);
    });
  };

  const done = () => {
    setResult(null);
    router.refresh();
  };

  // ---- The print --------------------------------------------------------
  if (result) {
    return (
      <>
        <div className="mb-6 flex flex-col gap-4 print:hidden">
          {result.slips.length > 0 && (
            <Alert tone="warning">
              <p className="font-semibold">
                {result.slips.length} new temporary password{result.slips.length === 1 ? "" : "s"} issued. They are shown only here.
              </p>
              <p className="mt-1">
                Print the slips now. Once you leave this page the passwords cannot be shown again; a lost slip needs a new one.
              </p>
            </Alert>
          )}
          {result.failed.length > 0 && (
            <Alert tone="danger">
              <p className="font-semibold">
                {result.failed.length} could not be issued. Their old passwords still work.
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.failed.map((f) => (
                  <li key={f.studentNumber}>
                    {f.name} ({f.studentNumber}): {f.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {result.slips.length > 0 && (
              <Button type="button" onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print slips
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={done}>
              Done
            </Button>
            <p className="text-fg-muted text-xs">Cut along the dashed lines. Each slip is for one student only.</p>
          </div>
        </div>
        {result.slips.length > 0 && <LoginSlipSheet slips={result.slips} />}
      </>
    );
  }

  // ---- The lists ----------------------------------------------------------
  return (
    <>
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <div role="tablist" aria-label="Students" className="border-line mb-4 flex gap-1 border-b">
        {(
          [
            ["pending", "Not signed in yet", counts.pending],
            ["changed", "Password changed", counts.changed],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setConfirming(null);
            }}
            className={cn(
              "-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold",
              tab === key ? "border-brand-fg text-brand-fg" : "text-fg-muted hover:text-fg border-transparent",
            )}
          >
            {label} <span className="text-fg-muted font-normal tabular-nums">({count})</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="slip-dept" className="text-xs">
            Department
          </Label>
          <Select id="slip-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="w-64">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="slip-search" className="text-xs">
            Search
          </Label>
          <Input id="slip-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or Student ID" className="w-64" />
        </div>
        {tab === "pending" && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-fg-muted text-sm tabular-nums">{selectedPending.length} selected</span>
            <Button
              type="button"
              disabled={selectedPending.length === 0 || selectedPending.length > maxPerPrint || pending}
              onClick={() => setConfirming(selectedPending)}
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print slips for {selectedPending.length} student{selectedPending.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </div>
      {tab === "pending" && selectedPending.length > maxPerPrint && (
        <Alert tone="info" className="mb-4">
          Print at most {maxPerPrint} slips at a time. Narrow the selection, for example to one department.
        </Alert>
      )}

      {confirming && (
        <Alert tone="warning" className="mb-4">
          <p className="font-semibold">
            <AlertTriangle className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
            Issue {confirming.length} new temporary password{confirming.length === 1 ? "" : "s"}?
          </p>
          <p className="mt-1">
            {confirming.length === 1 ? "This student's" : "Each student's"} current temporary password stops working, including one
            already on a slip handed out. The new {confirming.length === 1 ? "password is" : "passwords are"} shown once, on the slips.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => issue(confirming)} disabled={pending}>
              {pending ? "Issuing…" : `Yes, issue ${confirming.length === 1 ? "it" : `all ${confirming.length}`}`}
            </Button>
            <Button type="button" variant="close" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </Alert>
      )}

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <CardBody>
            <p className="text-fg-muted text-sm">
              {tab === "pending" ? "Every student in this list has changed their password." : "No student in this list has changed their password yet."}
            </p>
          </CardBody>
        ) : (
          <Table>
            <Thead>
              <tr>
                {tab === "pending" && (
                  <Th className="w-10 text-center">
                    <input type="checkbox" aria-label="Select all shown" checked={allVisibleSelected} onChange={toggleAll} />
                  </Th>
                )}
                <Th className="text-left">Student ID</Th>
                <Th className="text-left">Name</Th>
                <Th className="text-left">Department</Th>
                <Th className="text-left">{tab === "pending" ? "Password last issued" : "Status"}</Th>
                {tab === "changed" && <Th className="text-left">Action</Th>}
              </tr>
            </Thead>
            <tbody>
              {visible.map((s) => (
                <Tr key={s.studentId} className={selected.has(s.studentId) && tab === "pending" ? "bg-brand-subtle" : undefined}>
                  {tab === "pending" && (
                    <Td className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.sortName}`}
                        checked={selected.has(s.studentId)}
                        onChange={() => toggle(s.studentId)}
                      />
                    </Td>
                  )}
                  <Td className="font-mono tabular-nums">{s.studentNumber}</Td>
                  <Td className="text-fg font-semibold whitespace-nowrap">{s.sortName}</Td>
                  <Td>{s.departmentName}</Td>
                  {tab === "pending" ? (
                    <Td className="whitespace-nowrap">{issuedDate(s.lastIssuedAt)}</Td>
                  ) : (
                    <Td>
                      <Badge tone="success">Password changed</Badge>
                    </Td>
                  )}
                  {tab === "changed" && (
                    <Td>
                      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming([s.studentId])}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reset password
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-fg-muted mt-3 flex items-center gap-1.5 text-xs">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        Only active accounts are listed. Every slip printed and every reset is recorded in the audit log.
      </p>
    </>
  );
}
