"use server";

import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  commitCourseImport,
  previewCourseImport,
  type ImportPreview,
  type ImportResult,
} from "@/lib/courses/courseImport";

/**
 * The import screen's two calls.
 *
 * Both return a result rather than redirecting, because the paste itself
 * is the state and it is far too big to carry in a URL. The screen holds
 * the text between the two steps; the server holds no half-finished
 * import anywhere, which is the point -- there is nothing to leave lying
 * around if someone closes the tab.
 */

export type PreviewOutcome = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export async function previewCourseImportAction(text: string): Promise<PreviewOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, preview: await previewCourseImport(actor, text) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

export type CommitOutcome = { ok: true; result: ImportResult } | { ok: false; error: string };

export async function commitCourseImportAction(
  text: string,
  departmentByPrefix: Record<string, string>,
): Promise<CommitOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, result: await commitCourseImport(actor, { text, departmentByPrefix }) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}
