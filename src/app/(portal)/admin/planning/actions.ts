"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  approvePlan,
  approvePlanItem,
  overridePrerequisite,
  overrideScheduleConflict,
  rejectPlan,
  rejectPlanItem,
  undoPlanDecision,
  undoPlanItemDecision,
} from "@/lib/planning/planning";

function errorRedirect(planId: string, message: string): never {
  redirect(`/admin/planning/${planId}?error=${encodeURIComponent(message)}`);
}

/** Takes a decided plan back to Submitted so it can be reviewed again.
 *  Lands on the same page, which is now showing the plan back under
 *  review -- there is nowhere better to send somebody who has just
 *  undone a decision than the decision they are about to redo. */
export async function undoPlanDecisionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await undoPlanDecision(actor, planId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}?undone=1`);
}

/** Puts one course back to Pending, leaving the rest of the plan alone. */
export async function undoPlanItemDecisionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await undoPlanItemDecision(actor, planItemId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(planId, err.message);
    throw err;
  }
  redirect(`/admin/planning/${planId}?undone=course`);
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

/** Accepts a timetable clash on one planned course. Same form shape as the
 *  prerequisite override beside it. */
export async function overrideScheduleConflictAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const planId = String(formData.get("planId") ?? "");
  const planItemId = String(formData.get("planItemId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await overrideScheduleConflict(actor, planItemId, reason);
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
  const studentNumber = String(formData.get("studentNumber") ?? "").trim();
  const semesterId = String(formData.get("semesterId") ?? "");
  const { assertCan } = await import("@/lib/permissions/kernel");
  await assertCan(actor, "planning.reviewPlan");
  const { db } = await import("@/lib/db/client");
  const { coursePlan, student } = await import("@/lib/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");

  // The form now takes a typed Student ID rather than a picked row, so the
  // ID has to be resolved -- and a mistyped one told apart from a real
  // student with no plan, which are different problems for the office.
  const studentRow = await db.query.student.findFirst({
    where: sql`trim(${student.studentNumber}) = ${studentNumber}`,
  });
  if (!studentRow) {
    redirect(`/admin/planning?error=${encodeURIComponent(`No student has the ID "${studentNumber}".`)}`);
  }

  const plan = await db.query.coursePlan.findFirst({
    where: and(eq(coursePlan.studentId, studentRow.id), eq(coursePlan.semesterId, semesterId)),
  });
  if (!plan) {
    redirect(`/admin/planning?error=${encodeURIComponent("No plan exists for that student in that semester.")}`);
  }
  redirect(`/admin/planning/${plan.id}`);
}
