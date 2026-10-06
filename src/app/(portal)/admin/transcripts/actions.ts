"use server";

import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditWrite } from "@/lib/audit/audit";

/**
 * An official transcript going to the printer (or to a PDF). Logged before
 * the dialog opens, like every other print: it is the moment a copy of the
 * record leaves the system.
 */
export async function logTranscriptPrintAction(studentId: string): Promise<void> {
  const actor = await requireActor();
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new Error("Only the College's staff print an official transcript.");
  }
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "TRANSCRIPT_PRINTED",
      entityType: "student",
      entityId: studentId,
      studentId,
      newValue: { copy: "OFFICIAL" },
    }),
  );
}
