"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Sign-out for the new persistent header (design/professional-ui pass).
 * There was previously no sign-out control anywhere in the app -- every
 * page was a lone `<main>` with no shared chrome. Mirrors loginAction's
 * shape: a plain server action wired to a `<form action={...}>`, no client
 * JavaScript needed (consistent with DER-25's zero-JS-forms approach used
 * by /login and /change-password).
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
