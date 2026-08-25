"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/session";
import {
  createStaffAccount,
  disableAccount,
  enableAccount,
} from "@/lib/identity/accounts";
import { AppError } from "@/lib/errors";

export interface CreateAccountState {
  error?: string;
  success?: { username: string; temporaryPassword: string };
}

/**
 * Unlike login/change-password, this returns state to a client component
 * via useActionState rather than redirecting -- a generated temporary
 * password must be shown exactly once, and putting it in a redirect URL
 * would land it in server request logs, which Section 18.1 explicitly
 * rules out ("no credentials ... in application logs"). This screen is
 * Admin/Super-Admin-only, so the small amount of client JS this needs is
 * within the plan's admin budget (Section 20.1), unlike student pages.
 */
export async function createStaffAccountAction(
  _prevState: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const actor = await requireActor();

  const username = String(formData.get("username") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  const role = String(formData.get("role") ?? "");

  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { error: "Select a role." };
  }

  try {
    const result = await createStaffAccount({ actor, username, displayName, role });
    // This action returns state to a client component rather than
    // redirecting (see the note above), so the server-rendered account
    // table in the parent page won't otherwise know its data is stale.
    revalidatePath("/admin/accounts");
    return { success: result };
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message };
    }
    throw err;
  }
}

export async function disableAccountAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const targetUserId = String(formData.get("targetUserId") ?? "");

  try {
    await disableAccount(actor, targetUserId);
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/admin/accounts?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/admin/accounts");
}

export async function enableAccountAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const targetUserId = String(formData.get("targetUserId") ?? "");

  try {
    await enableAccount(actor, targetUserId);
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/admin/accounts?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/admin/accounts");
}
