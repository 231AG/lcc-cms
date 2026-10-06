"use server";

import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  commitGradeSheetImport,
  previewGradeSheetImport,
  type CommitGradeSheetResult,
} from "@/lib/historical/gradeSheetImport";
import type { ImportAnalysis } from "@/lib/historical/gradeSheetImportCore";
import {
  checkManualEntry,
  saveManualEntry,
  type ManualEntryCheck,
  type ManualEntryInput,
  type ManualEntryResult,
} from "@/lib/historical/manualEntry";

/**
 * The grade-sheet import's two calls. Both return a result rather than
 * redirecting: the file is the state, and the browser keeps it between the
 * check and the import. The server keeps nothing between them and checks
 * the whole file again before writing.
 */

export type PreviewOutcome = { ok: true; analysis: ImportAnalysis } | { ok: false; error: string };

export async function previewGradeSheetImportAction(text: string): Promise<PreviewOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, analysis: await previewGradeSheetImport(actor, text) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

export type CommitOutcome = { ok: true; result: CommitGradeSheetResult } | { ok: false; error: string };

export async function commitGradeSheetImportAction(
  text: string,
  fileName: string,
  confirmRepeats: boolean,
  confirmUncatalogued: boolean,
): Promise<CommitOutcome> {
  const actor = await requireActor();
  try {
    return {
      ok: true,
      result: await commitGradeSheetImport(actor, { text, fileName, confirmRepeats: confirmRepeats === true, confirmUncatalogued: confirmUncatalogued === true }),
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Entering one semester by hand
// ---------------------------------------------------------------------------

/** What the browser sends, re-typed here: nothing from it is trusted. */
function cleanManualInput(raw: ManualEntryInput): ManualEntryInput {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const rows = Array.isArray(raw?.rows) ? raw.rows.slice(0, 40) : [];
  return {
    studentId: String(raw?.studentId ?? ""),
    yearLabel: String(raw?.yearLabel ?? ""),
    sequence: Number(raw?.sequence) === 2 ? 2 : 1,
    paperGpa: num(raw?.paperGpa),
    confirmed: raw?.confirmed === true,
    rows: rows.map((r) => {
      const nc = r?.newCourse;
      return {
        code: String(r?.code ?? "").slice(0, 20),
        creditHours: Number(r?.creditHours),
        letter: String(r?.letter ?? "").slice(0, 4),
        paperPoints: num(r?.paperPoints),
        newCourse:
          nc?.mode === "catalogue"
            ? { mode: "catalogue", title: String(nc.title ?? "").slice(0, 120), departmentId: String(nc.departmentId ?? "") }
            : nc?.mode === "asPrinted"
              ? { mode: "asPrinted", title: String(nc.title ?? "").slice(0, 120) }
              : undefined,
      };
    }),
  };
}

export type ManualCheckOutcome = { ok: true; check: ManualEntryCheck } | { ok: false; error: string };

export async function checkManualEntryAction(input: ManualEntryInput): Promise<ManualCheckOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, check: await checkManualEntry(actor, cleanManualInput(input)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

export type ManualSaveOutcome = { ok: true; result: ManualEntryResult } | { ok: false; error: string };

export async function saveManualEntryAction(input: ManualEntryInput): Promise<ManualSaveOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, result: await saveManualEntry(actor, cleanManualInput(input)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}
