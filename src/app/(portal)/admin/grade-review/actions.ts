"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { approveSubmission, rejectSubmission } from "@/lib/grades/grades";

function errorRedirect(submissionId: string, message: string): never {
  redirect(`/admin/grade-review/${submissionId}?error=${encodeURIComponent(message)}`);
}

export async function approveSubmissionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const submissionId = String(formData.get("submissionId") ?? "");
  const selected = formData.getAll("gradeRecordId").map(String);
  try {
    await approveSubmission(actor, submissionId, selected.length > 0 ? selected : undefined, randomUUID());
  } catch (err) {
    if (err instanceof AppError) errorRedirect(submissionId, err.message);
    throw err;
  }
  redirect(`/admin/grade-review/${submissionId}`);
}

export async function rejectSubmissionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const submissionId = String(formData.get("submissionId") ?? "");
  const selected = formData.getAll("gradeRecordId").map(String);
  const reason = String(formData.get("reason") ?? "");
  try {
    await rejectSubmission(actor, submissionId, selected.length > 0 ? selected : undefined, reason, randomUUID());
  } catch (err) {
    if (err instanceof AppError) errorRedirect(submissionId, err.message);
    throw err;
  }
  redirect(`/admin/grade-review/${submissionId}`);
}
