"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { addPlanItem, deleteDraftPlan, getOrCreateDraftPlan, removePlanItem, revisePlan, submitPlan } from "@/lib/planning/planning";

function errorRedirect(semesterId: string, message: string): never {
  redirect(`/planning?semesterId=${semesterId}&error=${encodeURIComponent(message)}`);
}

export async function startPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  try {
    await getOrCreateDraftPlan(actor, semesterId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}

export async function addPlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await addPlanItem(actor, planId, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}

export async function removePlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  try {
    await removePlanItem(actor, planItemId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}

export async function submitPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  try {
    await submitPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}

export async function revisePlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  try {
    await revisePlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}

export async function deleteDraftPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  try {
    await deleteDraftPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/planning?semesterId=${semesterId}`);
}
