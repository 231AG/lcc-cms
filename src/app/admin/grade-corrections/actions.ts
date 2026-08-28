"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { decideCorrection, requestCorrection } from "@/lib/grades/grades";

function errorRedirect(message: string): never {
  redirect(`/admin/grade-corrections?error=${encodeURIComponent(message)}`);
}

export async function requestCorrectionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const gradeRecordId = String(formData.get("gradeRecordId") ?? "");
  const scoreRaw = String(formData.get("newScore") ?? "").trim();
  const isIncomplete = formData.get("isIncomplete") === "on";
  const reason = String(formData.get("reason") ?? "");
  try {
    await requestCorrection(actor, gradeRecordId, {
      newScore: isIncomplete ? undefined : Number(scoreRaw),
      isIncomplete,
      reason,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/grade-corrections");
}

export async function decideCorrectionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const correctionRequestId = String(formData.get("correctionRequestId") ?? "");
  const decision = String(formData.get("decision") ?? "") as "APPROVE" | "REJECT";
  const note = String(formData.get("note") ?? "");
  try {
    await decideCorrection(actor, correctionRequestId, decision, note || undefined);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/grade-corrections");
}
