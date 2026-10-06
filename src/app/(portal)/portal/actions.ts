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

/**
 * The student's own unofficial transcript going to the printer. Always the
 * signed-in student's own record -- there is no student id to pass in.
 */
export async function logOwnTranscriptPrintAction(): Promise<void> {
  const actor = await requireActor();
  if (actor.role !== "STUDENT") throw new Error("Only a student prints their own transcript here.");
  await db.transaction((tx) =>
    auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "TRANSCRIPT_PRINTED",
      entityType: "student",
      entityId: actor.userId,
      studentId: actor.userId,
      newValue: { copy: "UNOFFICIAL" },
    }),
  );
}
