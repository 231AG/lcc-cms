"use server";

import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditWrite } from "@/lib/audit/audit";

/** S-04's Print action: printing is logged (Section 20.4's "Printing is
 * logged: it produces a document that leaves the system"). */
export async function logSemesterPrintAction(semesterId: string): Promise<void> {
  const actor = await requireActor();
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "CLASS_SHEET_PRINTED",
      entityType: "semester",
      entityId: semesterId,
      studentId: actor.userId,
    }),
  );
}
