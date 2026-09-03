"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { approvePlan, approvePlanItem, overridePrerequisite, rejectPlan, rejectPlanItem } from "@/lib/planning/planning";

function errorRedirect(planId: string, message: string): never {
  redirect(`/admin/planning/${planId}?error=${encodeURIComponent(message)}`);
}

export async function approvePlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  try {
    await approvePlan(actor, planId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}`);
}

export async function rejectPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await rejectPlan(actor, planId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}`);
}

export async function approvePlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  try {
    await approvePlanItem(actor, planItemId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}`);
}

export async function rejectPlanItemAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await rejectPlanItem(actor, planItemId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}`);
}

export async function overridePrerequisiteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await overridePrerequisite(actor, planItemId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}`);
}

export async function findPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const semesterId = String(formData.get("semesterId") ?? "");
  const { assertCan } = await import("@/lib/permissions/kernel");
  await assertCan(actor, "planning.reviewPlan");
  const { db } = await import("@/lib/db/client");
  const { coursePlan } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const plan = await db.query.coursePlan.findFirst({ where: and(eq(coursePlan.studentId, studentId), eq(coursePlan.semesterId, semesterId)) });
  if (!plan) {
    redirect(`/admin/planning?error=${encodeURIComponent("No plan exists for that student in that semester.")}`);
  }
  redirect(`/admin/planning/${plan.id}`);
}
