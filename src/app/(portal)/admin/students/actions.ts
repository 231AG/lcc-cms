"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  enrollStudent,
  resetStudentPassword,
  updateStudentProfile,
  type StudentGender,
  type StudentStatus,
} from "@/lib/students/students";
import { removeStudentPhoto, setStudentPhoto } from "@/lib/students/photo";

export interface EnrollStudentState {
  error?: string;
  success?: { studentNumber: string; temporaryPassword: string };
}

/**
 * Returns state via useActionState rather than redirecting, same reason as
 * createStaffAccountAction (admin/accounts/actions.ts): a generated
 * temporary password must be shown exactly once, and a redirect URL would
 * land it in server request logs (Section 18.1).
 */
export async function enrollStudentAction(
  _prevState: EnrollStudentState,
  formData: FormData,
): Promise<EnrollStudentState> {
  const actor = await requireActor();

  try {
    const result = await enrollStudent(actor, {
      studentNumber: String(formData.get("studentNumber") ?? ""),
      firstName: String(formData.get("firstName") ?? ""),
      middleName: String(formData.get("middleName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      gender: String(formData.get("gender") ?? "") as StudentGender,
      // The College field is a UI affordance for narrowing the Department
      // list; the record hangs off the department, which already names its
      // college. Nothing reads a collegeId off the form.
      departmentId: String(formData.get("departmentId") ?? ""),
      enrolmentYear: Number(formData.get("enrolmentYear") ?? ""),
      minor: String(formData.get("minor") ?? ""),
      contactPhone: String(formData.get("contactPhone") ?? ""),
    });
    revalidatePath("/admin/students");
    return { success: result };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export interface ResetPasswordState {
  error?: string;
  success?: { temporaryPassword: string };
}

export async function resetStudentPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");

  try {
    const result = await resetStudentPassword(actor, studentId);
    return { success: result };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function updateStudentProfileAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const enrolmentYearRaw = String(formData.get("enrolmentYear") ?? "").trim();
  const contactPhoneRaw = String(formData.get("contactPhone") ?? "").trim();
  const genderRaw = String(formData.get("gender") ?? "").trim();
  try {
    await updateStudentProfile(actor, studentId, {
      studentNumber: String(formData.get("studentNumber") ?? ""),
      firstName: String(formData.get("firstName") ?? ""),
      // "" is a real instruction here (clear the middle name), so unlike the
      // required names this is passed through rather than coerced away.
      middleName: String(formData.get("middleName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      // Left unset rather than sent as "" when the field is still blank on a
      // student enrolled before gender existed, so submitting the form
      // without touching it does not trip the CHECK.
      gender: genderRaw ? (genderRaw as StudentGender) : undefined,
      departmentId: String(formData.get("departmentId") ?? ""),
      enrolmentYear: enrolmentYearRaw ? Number(enrolmentYearRaw) : undefined,
      // "" is a real instruction here too: it clears a recorded minor.
      minor: String(formData.get("minor") ?? ""),
      contactPhone: contactPhoneRaw || null,
      status: String(formData.get("status") ?? "") as StudentStatus,
    });
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/admin/students/${studentId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/admin/students/${studentId}`);
}

/**
 * Upload or replace a student's photograph.
 *
 * The file arrives as a `File` inside the FormData -- Next parses the
 * multipart body itself, so there is no upload library here. The bytes are
 * read in full before anything else happens, which is fine at a 2 MB cap
 * and is what lets the service sniff the real format rather than trusting
 * the browser's guess at it.
 */
export async function uploadStudentPhotoAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  const file = formData.get("photo");

  const fail = (message: string) => redirect(`/admin/students/${studentId}?error=${encodeURIComponent(message)}`);

  if (!(file instanceof File) || file.size === 0) fail("Choose an image file first.");
  const upload = file as File;

  try {
    const bytes = new Uint8Array(await upload.arrayBuffer());
    await setStudentPhoto(actor, studentId, bytes, upload.type || undefined);
  } catch (err) {
    if (err instanceof AppError) fail(err.message);
    throw err;
  }
  // The <img> points at a route whose response is cached for five minutes,
  // so re-rendering the page alone would show the old photo. Revalidating
  // is still right for the rest of the page; the cache-buster on the src is
  // what actually refreshes the image.
  revalidatePath(`/admin/students/${studentId}`);
  redirect(`/admin/students/${studentId}`);
}

export async function removeStudentPhotoAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId") ?? "");
  try {
    await removeStudentPhoto(actor, studentId);
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/admin/students/${studentId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath(`/admin/students/${studentId}`);
  redirect(`/admin/students/${studentId}`);
}
