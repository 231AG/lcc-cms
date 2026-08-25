"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { resolveLoginIdentifierToEmail } from "@/lib/identity/resolve";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Login (REQ-A01). A failed identifier resolution and a failed password
 * produce the exact same redirect and message, so the form cannot be used
 * to enumerate valid Student IDs / usernames (Section 18.2).
 */
export async function loginAction(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    redirect("/login?error=1");
  }

  let email: string;
  try {
    email = resolveLoginIdentifierToEmail(identifier);
  } catch {
    // Malformed identifier -- same generic failure as a wrong password.
    redirect("/login?error=1");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    redirect("/login?error=1");
  }

  const row = await db.query.appUser.findFirst({
    where: eq(appUser.id, data.user.id),
  });

  if (!row || row.status !== "ACTIVE") {
    await supabase.auth.signOut();
    redirect("/login?error=disabled");
  }

  if (row.mustChangePassword) {
    redirect("/change-password");
  }

  redirect("/portal");
}
