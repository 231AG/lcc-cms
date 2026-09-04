"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkPasswordPolicy, isObviousPassword, passwordPolicyFor } from "@/lib/identity/passwordPolicy";
import type { Role } from "@/lib/permissions/kernel";

/**
 * REQ-A03: forced first-login (and post-reset) password change.
 *
 * This one action is BOTH entry points the app has: the forced
 * first-login/post-reset change (src/proxy.ts redirects every other route
 * here while must_change_password is set) and the self-service change from
 * the header's "Change password" link. They are the same route and the same
 * form, so a rule added here necessarily applies to both -- there is no
 * second path that could drift.
 *
 * The rule itself is role-dependent (see lib/identity/passwordPolicy.ts):
 * students get the simple 6-character/one-number/one-lowercase rule,
 * staff keep the 10-character minimum they already had.
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

  // The role is read from the database, never from the form: the policy a
  // password is judged against must not be something the client can pick.
  const [row] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, user.id)).limit(1);
  const policy = passwordPolicyFor(row?.role as Role | undefined);

  if (newPassword !== confirmPassword || checkPasswordPolicy(newPassword, policy)) {
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
