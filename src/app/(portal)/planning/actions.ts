"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  addPlanItem,
  deleteDraftPlan,
  getOrCreateDraftPlan,
  removePlanItem,
  revisePlan,
  submitPlan,
  withdrawPlan,
} from "@/lib/planning/planning";

/**
 * Every action returns the student to the offerings list they were looking
 * at -- the same semester, search term and page -- rather than to the top
 * of a 177-offering catalogue. `q`/`page` ride along as hidden fields on
 * each form; absent ones are simply omitted from the redirect.
 */
function listUrl(formData: FormData, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ semesterId: String(formData.get("semesterId") ?? "") });
  for (const key of ["q", "page"] as const) {
    const value = formData.get(key);
    if (typeof value === "string" && value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return `/planning?${params.toString()}`;
}

function errorRedirect(formData: FormData, message: string): never {
  redirect(listUrl(formData, { error: message }));
}

export async function startPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  try {
    await getOrCreateDraftPlan(actor, semesterId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function addPlanItemAction(formData: FormData): Promise<void> {
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

export async function removePlanItemAction(formData: FormData): Promise<void> {
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

export async function submitPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await submitPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

/** Pulls a submitted plan back out of the review queue so it can be edited
 *  again. See withdrawPlan for why this is a deliberate step rather than
 *  something an edit does silently. */
export async function withdrawPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await withdrawPlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function revisePlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await revisePlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(formData, err.message);
    throw err;
  }
  redirect(listUrl(formData));
}

export async function deleteDraftPlanAction(formData: FormData): Promise<void> {
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
