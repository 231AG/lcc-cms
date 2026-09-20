"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { requestCorrection } from "@/lib/grades/grades";

/**
 * The Student grades screen's one mutation: propose a correction to a
 * published grade.
 *
 * Deliberately the same `requestCorrection` service call that
 * /admin/grade-corrections makes -- the two-key rule, the semester-state
 * check and the audit entry all live in there, and a second entry point
 * that re-implemented any of them would be a second set of rules to keep
 * in step. All this action does is read the form and come back to the
 * student it was filed from.
 */
export async function requestCorrectionFromStudentGradesAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const gradeRecordId = String(formData.get("gradeRecordId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const sq = String(formData.get("sq") ?? "");
  const scoreRaw = String(formData.get("newScore") ?? "").trim();
  const isIncomplete = formData.get("isIncomplete") === "on";
  const reason = String(formData.get("reason") ?? "");

  const back = (params: Record<string, string>) => {
    const query = new URLSearchParams({ studentId, ...(sq ? { sq } : {}), ...params });
    redirect(`/admin/student-grades?${query.toString()}`);
  };

  try {
    await requestCorrection(actor, gradeRecordId, {
      // A blank score with Incomplete unticked is left undefined rather
      // than sent as NaN: the service already says "a new score or
      // Incomplete is required", and that is the message to show.
      newScore: isIncomplete || scoreRaw === "" ? undefined : Number(scoreRaw),
      isIncomplete,
      reason,
    });
  } catch (err) {
    if (err instanceof AppError) back({ error: err.message });
    throw err;
  }
  back({ requested: "1" });
}
