"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MIN_LENGTH = 10;

/**
 * REQ-A03: forced first-login (and post-reset) password change.
 *
 * Clearing must_change_password is deliberately done via the superuser
 * `db` connection, not asUser() -- the `authenticated` role has no UPDATE
 * grant on app_user at all (DER-20-style lockdown mirrored onto identity;
 * see 0003_identity_constraints_rls.sql). This is the one narrow,
 * explicitly-scoped exception: the WHERE clause is pinned to the id taken
 * from the verified session, never from client input.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < MIN_LENGTH || newPassword !== confirmPassword) {
    redirect("/change-password?error=1");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    redirect("/change-password?error=1");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(appUser)
      .set({ mustChangePassword: false })
      .where(eq(appUser.id, user.id));

    await auditWrite(tx, {
      actorUserId: user.id,
      action: "PASSWORD_CHANGED_BY_SELF",
      entityType: "app_user",
      entityId: user.id,
    });
  });

  redirect("/portal");
}
