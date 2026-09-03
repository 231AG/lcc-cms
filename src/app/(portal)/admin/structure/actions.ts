"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  createCollege,
  updateCollege,
  setCollegeActive,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  createCourse,
  updateCourse,
  setCourseActive,
  addPrerequisite,
  removePrerequisite,
} from "@/lib/academic/structure";

function errorRedirect(message: string): never {
  redirect(`/admin/structure?error=${encodeURIComponent(message)}`);
}

export async function createCollegeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await createCollege(actor, {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function updateCollegeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("collegeId") ?? "");
  try {
    await updateCollege(actor, id, {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function toggleCollegeActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("collegeId") ?? "");
  const isActive = formData.get("isActive") === "true";
  try {
    await setCollegeActive(actor, id, isActive);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function createDepartmentAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const maxCreditsRaw = String(formData.get("maxCreditsOverride") ?? "").trim();
  try {
    await createDepartment(actor, {
      collegeId: String(formData.get("collegeId") ?? ""),
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      maxCreditsOverride: maxCreditsRaw ? Number(maxCreditsRaw) : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function updateDepartmentAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("departmentId") ?? "");
  const maxCreditsRaw = String(formData.get("maxCreditsOverride") ?? "").trim();
  try {
    await updateDepartment(actor, id, {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      maxCreditsOverride: maxCreditsRaw ? Number(maxCreditsRaw) : null,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function toggleDepartmentActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("departmentId") ?? "");
  const isActive = formData.get("isActive") === "true";
  try {
    await setDepartmentActive(actor, id, isActive);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function createCourseAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await createCourse(actor, {
      departmentId: String(formData.get("departmentId") ?? ""),
      code: String(formData.get("code") ?? ""),
      title: String(formData.get("title") ?? ""),
      creditHours: Number(formData.get("creditHours") ?? 0),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function updateCourseAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("courseId") ?? "");
  try {
    await updateCourse(actor, id, {
      code: String(formData.get("code") ?? ""),
      title: String(formData.get("title") ?? ""),
      creditHours: Number(formData.get("creditHours") ?? 0),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function toggleCourseActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("courseId") ?? "");
  const isActive = formData.get("isActive") === "true";
  try {
    await setCourseActive(actor, id, isActive);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function addPrerequisiteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await addPrerequisite(actor, {
      courseId: String(formData.get("courseId") ?? ""),
      prerequisiteCourseId: String(formData.get("prerequisiteCourseId") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}

export async function removePrerequisiteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    await removePrerequisite(actor, {
      courseId: String(formData.get("courseId") ?? ""),
      prerequisiteCourseId: String(formData.get("prerequisiteCourseId") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(err.message);
    throw err;
  }
  redirect("/admin/structure");
}
