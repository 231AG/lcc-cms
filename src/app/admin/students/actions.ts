"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { enrollStudent, resetStudentPassword, updateStudentProfile, type StudentStatus } from "@/lib/students/students";

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
      lastName: String(formData.get("lastName") ?? ""),
      departmentId: String(formData.get("departmentId") ?? ""),
      enrolmentYear: Number(formData.get("enrolmentYear") ?? ""),
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
  try {
    await updateStudentProfile(actor, studentId, {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      departmentId: String(formData.get("departmentId") ?? ""),
      enrolmentYear: enrolmentYearRaw ? Number(enrolmentYearRaw) : undefined,
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
