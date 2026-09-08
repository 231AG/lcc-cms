"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditWrite } from "@/lib/audit/audit";
import { AppError } from "@/lib/errors";
import { updateGradeSheetSignatories } from "@/lib/settings/signatories";

/**
 * Printing produces a document that leaves the system, so it is logged --
 * the same rule (and the same audit action) as the student's own semester
 * print on /portal.
 */
export async function logGradeSheetPrintAction(studentId: string, semesterId: string): Promise<void> {
  const actor = await requireActor();
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "CLASS_SHEET_PRINTED",
      entityType: "semester",
      entityId: semesterId,
      studentId,
    }),
  );
}

export async function updateSignatoriesAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const semesterId = String(formData.get("semesterId") ?? "");
  const back = `/admin/students/${studentId}/grade-sheet/${semesterId}`;

  try {
    await updateGradeSheetSignatories(actor, {
      signedName: String(formData.get("signedName") ?? ""),
      signedTitle: String(formData.get("signedTitle") ?? ""),
      approvedName: String(formData.get("approvedName") ?? ""),
      approvedTitle: String(formData.get("approvedTitle") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(back);
}
