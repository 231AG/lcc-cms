import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { auditWrite } from "@/lib/audit/audit";
import { resolveLoginIdentifierToEmail } from "@/lib/identity/resolve";

/**
 * One-time creation of the first Super Admin account (DER-26), run
 * directly from the command line -- outside the normal UI, because
 * nothing else in the system can create a Super Admin yet. Audited like
 * any other account creation.
 *
 * Usage: npx tsx src/lib/db/bootstrap.ts <username> <display name...>
 * You will be prompted for nothing -- it generates a temporary password
 * and prints it once. Change it on first login (forced).
 */

function generateTemporaryPassword(): string {
  // 16 random bytes, base64url -- comfortably above any reasonable
  // minimum length policy, never logged anywhere but this one-time print.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url");
}

async function main() {
  const [, , username, ...nameParts] = process.argv;
  const displayName = nameParts.join(" ");

  if (!username || !displayName) {
    console.error("Usage: npx tsx src/lib/db/bootstrap.ts <username> <display name...>");
    console.error('Example: npx tsx src/lib/db/bootstrap.ts vpaa.admin "VPAA Office"');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const connectionString = process.env.DATABASE_URL;

  if (!url || !serviceRoleKey || !connectionString) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL must all be set in .env.local.",
    );
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pgClient = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(pgClient, { schema });

  const normalizedIdentifier = username.trim().toLowerCase();
  const syntheticEmail = resolveLoginIdentifierToEmail(normalizedIdentifier);
  const temporaryPassword = generateTemporaryPassword();

  console.log(`Creating Auth user for "${normalizedIdentifier}"...`);
  const { data: authUser, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: temporaryPassword,
      email_confirm: true,
    });

  if (authError || !authUser?.user) {
    throw new Error(`Failed to create Auth user: ${authError?.message}`);
  }

  console.log("Creating app_user row and audit entry...");
  await db.transaction(async (tx) => {
    await tx.insert(schema.appUser).values({
      id: authUser.user.id,
      loginIdentifier: normalizedIdentifier,
      displayName,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: true,
    });

    await auditWrite(tx, {
      actorUserId: authUser.user.id,
      actorRole: "SUPER_ADMIN",
      action: "USER_CREATED",
      entityType: "app_user",
      entityId: authUser.user.id,
      newValue: { loginIdentifier: normalizedIdentifier, displayName, role: "SUPER_ADMIN" },
      reason: "Bootstrap procedure (DER-26): first Super Admin account.",
    });
  });

  await pgClient.end();

  console.log("");
  console.log("=".repeat(60));
  console.log("BOOTSTRAP SUPER ADMIN CREATED");
  console.log("=".repeat(60));
  console.log(`Username:           ${normalizedIdentifier}`);
  console.log(`Temporary password: ${temporaryPassword}`);
  console.log("");
  console.log("This password is shown ONCE and is not stored anywhere in");
  console.log("plaintext. Log in and change it immediately -- the account");
  console.log("is already flagged to force that on first login.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
