"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { sequenceForName } from "@/lib/academic/semesterName";
import { createAcademicYear, createSemester, deleteSemester, transitionSemester } from "@/lib/academic/calendar";
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
    // Name and sequence come from one choice, so they cannot contradict
    // each other -- see SEMESTER_NAME_OPTIONS.
    const name = String(formData.get("name") ?? "");
    const sequence = sequenceForName(name);
    if (!sequence) errorRedirect("Choose Semester I or Semester II.");
    await createSemester(actor, {
      academicYearId: String(formData.get("academicYearId") ?? ""),
      sequence,
      name,
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

/**
 * Deleting a Draft semester. Redirects back to the calendar either way --
 * a failure (not a Draft, or offerings still attached) comes back as the
 * page's own error banner rather than an unstyled exception screen.
 */
export async function deleteSemesterAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await deleteSemester(actor, String(formData.get("semesterId") ?? ""));
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/calendar");
}
