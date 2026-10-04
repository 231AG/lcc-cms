"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  correctHistoricalRecord,
  markImportComplete,
  reopenImportStatus,
  voidHistoricalRecord,
} from "@/lib/historical/historical";

function errorRedirect(studentId: string, semesterId: string | null, message: string): never {
  const params = new URLSearchParams({ studentId, error: message });
  if (semesterId) params.set("semesterId", semesterId);
  redirect(`/admin/historical?${params.toString()}`);
}

export async function correctHistoricalRecordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const creditHoursRaw = String(formData.get("creditHours") ?? "").trim();
  const scoreRaw = String(formData.get("score") ?? "").trim();

  try {
    await correctHistoricalRecord(actor, recordId, {
      creditHours: creditHoursRaw ? Number(creditHoursRaw) : undefined,
      letter: String(formData.get("letter") ?? "").trim() || undefined,
      score: scoreRaw ? Number(scoreRaw) : null,
      sourceNote: String(formData.get("sourceNote") ?? "").trim() || null,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, null, err.message);
    throw err;
  }
  redirect(`/admin/historical?studentId=${studentId}`);
}

export async function voidHistoricalRecordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await voidHistoricalRecord(actor, recordId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, null, err.message);
    throw err;
  }
  redirect(`/admin/historical?studentId=${studentId}`);
}

export async function markImportCompleteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  try {
    await markImportComplete(actor, studentId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, null, err.message);
    throw err;
  }
  redirect(`/admin/historical?studentId=${studentId}`);
}

export async function reopenImportStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await reopenImportStatus(actor, studentId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, null, err.message);
    throw err;
  }
  redirect(`/admin/historical?studentId=${studentId}`);
}
