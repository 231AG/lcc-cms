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
