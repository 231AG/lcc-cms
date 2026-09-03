"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MIN_LENGTH = 10;

/**
 * §18 RECOMMENDED: "Password policy -- minimum length with a rejection
 * list of obvious values." Small and deliberately so: the plan explicitly
 * rules out forced periodic rotation ("reliably produces weaker passwords
 * written on desks") and this app has no external breach-database check
 * available -- this catches the obvious case (a temporary/reset password
 * left unchanged in substance, or a keyboard-walk) without pretending to
 * be a full password-strength library.
 */
const OBVIOUS_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd",
  "12345678", "123456789", "1234567890", "qwertyuiop",
  "letmein123", "changeme123", "welcome123", "admin1234",
]);

function isObviousPassword(password: string): boolean {
  const normalized = password.toLowerCase().replace(/\s+/g, "");
  return OBVIOUS_PASSWORDS.has(normalized);
}

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
  if (isObviousPassword(newPassword)) {
    redirect("/change-password?error=2");
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
