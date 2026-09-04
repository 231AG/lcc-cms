"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createAcademicYear, createSemester, transitionSemester } from "@/lib/academic/calendar";
import type { SemesterState } from "@/lib/academic/semesterStateMachine";

function errorRedirect(message: string): never {
  redirect(`/admin/calendar?error=${encodeURIComponent(message)}`);
}

export async function createAcademicYearAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await createAcademicYear(actor, {
      label: String(formData.get("label") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/calendar");
}

export async function createSemesterAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await createSemester(actor, {
      academicYearId: String(formData.get("academicYearId") ?? ""),
      sequence: Number(formData.get("sequence") ?? 1) as 1 | 2,
      name: String(formData.get("name") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/calendar");
}

export async function transitionSemesterAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await transitionSemester(actor, {
      semesterId: String(formData.get("semesterId") ?? ""),
      toState: String(formData.get("toState") ?? "") as SemesterState,
      reason: String(formData.get("reason") ?? "").trim() || undefined,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/calendar");
}
