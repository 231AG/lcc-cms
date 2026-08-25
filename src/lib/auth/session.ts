import "server-only";
import { eq } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import { appUser } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions/kernel";

export interface Actor {
  userId: string;
  role: Role;
  displayName: string;
  loginIdentifier: string;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
}

/**
 * Resolves the current request's signed-in identity, if any. Reads the
 * session from Supabase Auth (cookie-verified) and then looks up the
 * matching app_user row for role/status -- the two must always be read
 * together, because the session alone says who authenticated, not what
 * they may do (Section 8.1, P1: the client is never trusted with that
 * decision).
 */
export async function getCurrentActor(): Promise<Actor | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Reads through RLS as this user, not through the superuser connection
  // (see asUser.ts) -- so "the current user can only read their own row"
  // is actually true of this query, not merely true of the policy on paper.
  const row = await asUser(user.id, (tx) =>
    tx.query.appUser.findFirst({ where: eq(appUser.id, user.id) }),
  );

  if (!row || row.status !== "ACTIVE") return null;

  return {
    userId: row.id,
    role: row.role as Role,
    displayName: row.displayName,
    loginIdentifier: row.loginIdentifier,
    status: row.status as "ACTIVE" | "DISABLED",
    mustChangePassword: row.mustChangePassword,
  };
}

/** Throws if nobody is signed in. Use in every protected Server Component/Action. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) {
    throw new Error("Not signed in.");
  }
  return actor;
}
