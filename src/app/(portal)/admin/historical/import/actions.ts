"use server";

import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  commitGradeSheetImport,
  previewGradeSheetImport,
  type CommitGradeSheetResult,
} from "@/lib/historical/gradeSheetImport";
import type { ImportAnalysis } from "@/lib/historical/gradeSheetImportCore";

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
