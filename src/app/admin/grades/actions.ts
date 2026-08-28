"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { clearDraftGrade, saveClassDraft, submitClass, type DraftGradeEntry } from "@/lib/grades/grades";

function errorRedirect(offeringId: string, message: string): never {
  redirect(`/admin/grades?offeringId=${offeringId}&error=${encodeURIComponent(message)}`);
}

/**
 * The whole class saves as one call (Section 15.3) -- every score/version
 * field on the form is parsed here and passed to saveClassDraft together,
 * never one row at a time.
 */
export async function saveClassDraftAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const offeringId = String(formData.get("offeringId") ?? "");
  const registrationIds = formData.getAll("registrationId").map(String);

  const entries: DraftGradeEntry[] = [];
  for (const registrationId of registrationIds) {
    const scoreRaw = String(formData.get(`score_${registrationId}`) ?? "").trim();
    const incomplete = formData.get(`incomplete_${registrationId}`) === "on";
    const versionRaw = String(formData.get(`version_${registrationId}`) ?? "").trim();
    if (!incomplete && !scoreRaw) continue; // untouched row -- leave as-is

    entries.push({
      registrationId,
      score: incomplete ? undefined : Number(scoreRaw),
      isIncomplete: incomplete,
      expectedVersion: versionRaw ? Number(versionRaw) : undefined,
    });
  }

  if (entries.length === 0) {
    errorRedirect(offeringId, "No grades were entered.");
  }

  try {
    await saveClassDraft(actor, offeringId, entries, randomUUID());
  } catch (err) {
    if (err instanceof AppError) errorRedirect(offeringId, err.message);
    throw err;
  }
  redirect(`/admin/grades?offeringId=${offeringId}`);
}

export async function clearDraftGradeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const offeringId = String(formData.get("offeringId") ?? "");
  const gradeRecordId = String(formData.get("gradeRecordId") ?? "");
  try {
    await clearDraftGrade(actor, gradeRecordId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(offeringId, err.message);
    throw err;
  }
  redirect(`/admin/grades?offeringId=${offeringId}`);
}

export async function submitClassAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const offeringId = String(formData.get("offeringId") ?? "");
  const confirmPartial = formData.get("confirmPartial") === "on";
  const partialNote = String(formData.get("partialNote") ?? "");
  try {
    await submitClass(actor, offeringId, { confirmPartial, partialNote }, randomUUID());
  } catch (err) {
    if (err instanceof AppError) errorRedirect(offeringId, err.message);
    throw err;
  }
  redirect(`/admin/grades?offeringId=${offeringId}`);
}
