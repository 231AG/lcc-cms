import { eq, and, ne } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor, type Role } from "@/lib/permissions/kernel";
import { resolveLoginIdentifierToEmail } from "@/lib/identity/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { ValidationError, StateError } from "@/lib/errors";

function generateTemporaryPassword(): string {
  return randomBytes(16).toString("base64url");
}

export interface CreateStaffAccountInput {
  actor: Actor;
  username: string;
  displayName: string;
  role: Extract<Role, "ADMIN" | "SUPER_ADMIN">;
}

/**
 * REQ-A06 / DEC-15: only a Super Admin creates Admin accounts, and may also
 * create other Super Admins. There is no self-service registration
 * anywhere in this system.
 */
export async function createStaffAccount(
  input: CreateStaffAccountInput,
): Promise<{ username: string; temporaryPassword: string }> {
  await assertCan(input.actor, "identity.createStaffAccount");

  const username = input.username.trim().toLowerCase();
  if (!username || !input.displayName.trim()) {
    throw new ValidationError("Username and display name are required.");
  }
  if (input.role !== "ADMIN" && input.role !== "SUPER_ADMIN") {
    throw new ValidationError("Role must be ADMIN or SUPER_ADMIN.");
  }

  const email = resolveLoginIdentifierToEmail(username);
  const temporaryPassword = generateTemporaryPassword();

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("already")) {
      throw new ValidationError(`"${username}" is already in use.`);
    }
    throw new Error(`Failed to create account: ${error?.message}`);
  }

  await db.transaction(async (tx) => {
    await tx.insert(appUser).values({
      id: data.user.id,
      loginIdentifier: username,
      displayName: input.displayName.trim(),
      role: input.role,
      status: "ACTIVE",
      mustChangePassword: true,
      createdBy: input.actor.userId,
    });

    await auditWrite(tx, {
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: "USER_CREATED",
      entityType: "app_user",
      entityId: data.user.id,
      newValue: { loginIdentifier: username, displayName: input.displayName, role: input.role },
    });
  });

  return { username, temporaryPassword };
}

async function countOtherActiveSuperAdmins(excludingUserId: string): Promise<number> {
  const rows = await db.query.appUser.findMany({
    where: and(
      eq(appUser.role, "SUPER_ADMIN"),
      eq(appUser.status, "ACTIVE"),
      ne(appUser.id, excludingUserId),
    ),
  });
  return rows.length;
}

export async function disableAccount(actor: Actor, targetUserId: string): Promise<void> {
  await assertCan(actor, "identity.disableAccount");

  const target = await db.query.appUser.findFirst({ where: eq(appUser.id, targetUserId) });
  if (!target) throw new ValidationError("Account not found.");

  if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE") {
    const others = await countOtherActiveSuperAdmins(targetUserId);
    if (others === 0) {
      throw new StateError(
        "At least one active Super Admin must exist at all times -- create another Super Admin before disabling this one.",
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(appUser).set({ status: "DISABLED" }).where(eq(appUser.id, targetUserId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "USER_DISABLED",
      entityType: "app_user",
      entityId: targetUserId,
      oldValue: { status: target.status },
      newValue: { status: "DISABLED" },
    });
  });
}

export async function enableAccount(actor: Actor, targetUserId: string): Promise<void> {
  await assertCan(actor, "identity.enableAccount");

  const target = await db.query.appUser.findFirst({ where: eq(appUser.id, targetUserId) });
  if (!target) throw new ValidationError("Account not found.");

  await db.transaction(async (tx) => {
    await tx.update(appUser).set({ status: "ACTIVE" }).where(eq(appUser.id, targetUserId));
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "USER_ENABLED",
      entityType: "app_user",
      entityId: targetUserId,
      oldValue: { status: target.status },
      newValue: { status: "ACTIVE" },
    });
  });
}
