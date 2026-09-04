"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { addPlanItem, deleteDraftPlan, getOrCreateDraftPlan, removePlanItem, submitPlan } from "@/lib/planning/planning";

/**
 * DEV-20: an Admin building a course plan for a student who cannot use the
 * app themselves. Every action here calls the SAME service function the
 * student's own /planning page calls -- the only difference is that
 * `getOrCreateDraftPlan` is given an explicit student, and the service
 * layer's `authorizePlanSubject` requires `planning.manageStudentPlan` for
 * that case. No validator, credit ceiling or state transition is
 * duplicated here.
 */
function listUrl(formData: FormData, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const key of ["studentId", "semesterId", "q", "page"] as const) {
    const value = formData.get(key);
    if (typeof value === "string" && value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return `/admin/student-plan?${params.toString()}`;
}

function errorRedirect(formData: FormData, message: string): never {
  redirect(listUrl(formData, { error: message }));
}

export async function startStudentPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  try {
    await getOrCreateDraftPlan(actor, semesterId, studentId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function addStudentPlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await addPlanItem(actor, planId, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function removeStudentPlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planItemId = String(formData.get("planItemId") ?? "");
  try {
    await removePlanItem(actor, planItemId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function submitStudentPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await submitPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData, { submitted: "1" }));
}

export async function deleteStudentDraftPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await deleteDraftPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}
