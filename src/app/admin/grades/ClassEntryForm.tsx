"use client";

import { useRef, useState } from "react";
import { deriveLetterFromScore, type GradeScaleEntry } from "@/lib/gpa/engine";
import { clearDraftGradeAction, saveClassDraftAction } from "./actions";

export interface RosterRowProps {
  registrationId: string;
  studentNumber: string;
  studentName: string;
  isRetake: boolean;
  gradeId: string | null;
  currentScore: string | null;
  currentLetter: string | null;
  currentVersion: number | null;
  status: string | null; // grade status, or null if no row yet
}

/**
 * A-12 (Section 20.6): live letter/grade-point preview beside each score
 * as it's typed -- "so 96 immediately reads 'A+ -- 4.00'" (Section
 * 15.3) -- and Enter/Down commits a field and moves to the next student,
 * "because the classic error is drifting one row out of alignment with
 * the paper." Both are advisory, client-side presentation over data the
 * server already supplied (same status as Stage 9's client-side V4/V6
 * copy) -- the actual save is one ordinary form POST to a Server Action,
 * still whole-class-one-transaction, still authoritative server-side.
 *
 * "Clear" lives in its own list below the entry table, each as its own
 * tiny form -- HTML forbids a <form> nested inside another, and the
 * entry table is already one big form covering the whole class.
 */
export default function ClassEntryForm({
  offeringId,
  roster,
  scale,
}: {
  offeringId: string;
  roster: RosterRowProps[];
  scale: GradeScaleEntry[];
}) {
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [incomplete, setIncomplete] = useState<Record<string, boolean>>(
    Object.fromEntries(roster.map((r) => [r.registrationId, r.currentLetter === "I"])),
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const order = roster.map((r) => r.registrationId);

  function handleScoreChange(registrationId: string, value: string) {
    if (!value.trim()) {
      setPreview((p) => ({ ...p, [registrationId]: "" }));
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setPreview((p) => ({ ...p, [registrationId]: "" }));
      return;
    }
    try {
      const { letter, gradePoint } = deriveLetterFromScore(num, scale);
      setPreview((p) => ({ ...p, [registrationId]: `${letter} — ${gradePoint ?? "—"}` }));
    } catch {
      setPreview((p) => ({ ...p, [registrationId]: "out of range" }));
    }
  }

  function focusNext(registrationId: string) {
    const idx = order.indexOf(registrationId);
    const next = order[idx + 1];
    if (next) inputRefs.current[next]?.focus();
  }

  const clearable = roster.filter((r) => r.gradeId && r.status === "DRAFT");

  return (
    <>
      <form action={saveClassDraftAction}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-1 pr-2">Student</th>
              <th className="py-1 pr-2">Score</th>
              <th className="py-1 pr-2">Incomplete</th>
              <th className="py-1 pr-2">Grade</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => {
              const locked = r.status !== null && r.status !== "DRAFT";
              return (
                <tr key={r.registrationId} className="border-b">
                  <td className="py-1.5 pr-2">
                    {r.studentName} <span className="text-xs text-gray-400">({r.studentNumber})</span>
                    {r.isRetake && <span className="ml-1 text-xs text-amber-700">retake</span>}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="hidden" name="registrationId" value={r.registrationId} />
                    {r.gradeId && <input type="hidden" name={`version_${r.registrationId}`} value={r.currentVersion ?? 0} />}
                    <input
                      ref={(el) => {
                        inputRefs.current[r.registrationId] = el;
                      }}
                      name={`score_${r.registrationId}`}
                      aria-label={`Score for ${r.studentName}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={locked || incomplete[r.registrationId]}
                      defaultValue={r.currentLetter !== "I" ? r.currentScore ?? "" : ""}
                      onChange={(e) => handleScoreChange(r.registrationId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          focusNext(r.registrationId);
                        }
                      }}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      name={`incomplete_${r.registrationId}`}
                      aria-label={`Incomplete for ${r.studentName}`}
                      disabled={locked}
                      defaultChecked={r.currentLetter === "I"}
                      onChange={(e) => setIncomplete((p) => ({ ...p, [r.registrationId]: e.target.checked }))}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-gray-600">
                    {preview[r.registrationId] || (r.currentLetter ? `${r.currentLetter} — ${r.currentScore ?? ""}` : "")}
                    {locked && <span className="ml-1 text-gray-400">({r.status})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
          Save draft
        </button>
      </form>

      {clearable.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-blue-700 underline">Clear a draft grade</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {clearable.map((r) => (
              <li key={r.registrationId} className="flex items-center gap-2 text-xs">
                <span>{r.studentName}</span>
                <form action={clearDraftGradeAction}>
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="gradeRecordId" value={r.gradeId!} />
                  <button type="submit" className="text-red-700 underline">Clear</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
