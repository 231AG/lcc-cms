"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  correctHistoricalRecord,
  createRetrospectiveSemester,
  enterHistoricalSemester,
  markImportComplete,
  reopenImportStatus,
  voidHistoricalRecord,
  type HistoricalRecordInput,
} from "@/lib/historical/historical";

function errorRedirect(studentId: string, semesterId: string | null, message: string): never {
  const params = new URLSearchParams({ studentId, error: message });
  if (semesterId) params.set("semesterId", semesterId);
  redirect(`/admin/historical?${params.toString()}`);
}

export async function createRetrospectiveSemesterAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  try {
    const sem = await createRetrospectiveSemester(actor, {
      academicYearId: String(formData.get("academicYearId") ?? ""),
      sequence: Number(formData.get("sequence") ?? 1) as 1 | 2,
      name: String(formData.get("name") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
    });
    redirect(`/admin/historical?studentId=${studentId}&semesterId=${sem.id}`);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, null, err.message);
    throw err;
  }
}

const MAX_ROWS = 8;

export async function enterHistoricalSemesterAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const semesterId = String(formData.get("semesterId") ?? "");

  const records: HistoricalRecordInput[] = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    const courseCode = String(formData.get(`courseCode-${i}`) ?? "").trim();
    if (!courseCode) continue;
    const creditHoursRaw = String(formData.get(`creditHours-${i}`) ?? "").trim();
    const scoreRaw = String(formData.get(`score-${i}`) ?? "").trim();
    records.push({
      courseCode,
      creditHours: Number(creditHoursRaw),
      letter: String(formData.get(`letter-${i}`) ?? "").trim(),
      score: scoreRaw ? Number(scoreRaw) : undefined,
      sourceNote: String(formData.get(`note-${i}`) ?? "").trim() || undefined,
      confirmAsRepeat: formData.get(`confirmAsRepeat-${i}`) === "on",
    });
  }

  if (records.length === 0) {
    errorRedirect(studentId, semesterId, "Enter at least one course.");
  }

  try {
    const result = await enterHistoricalSemester(actor, { studentId, semesterId, records });
    const params = new URLSearchParams({
      studentId,
      entered: String(result.created.length),
      warnings: String(result.warnings.length),
    });
    redirect(`/admin/historical?${params.toString()}`);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(studentId, semesterId, err.message);
    throw err;
  }
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
