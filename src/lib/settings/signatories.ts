import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { institutionSetting } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";

/**
 * Who signs a printed Student Grade Sheet.
 *
 * Stored as four rows in `institution_setting`, the table that exists so
 * that "every value that is currently an open decision lives here, and
 * answering it later is a config change, not a code change" (Section
 * 9.4.17). Deans change; a name compiled into a React component would mean
 * a deployment every time one did.
 *
 * The defaults below are the names on the College's existing printed sheet.
 * They are used when a key has never been set -- which keeps the grade
 * sheet correct on an installation whose seed has not been re-run, rather
 * than printing an empty signature block.
 */

export interface GradeSheetSignatories {
  signedName: string;
  signedTitle: string;
  approvedName: string;
  approvedTitle: string;
}

export const SIGNATORY_KEYS = {
  signedName: "grade_sheet_signed_name",
  signedTitle: "grade_sheet_signed_title",
  approvedName: "grade_sheet_approved_name",
  approvedTitle: "grade_sheet_approved_title",
} as const;

export const DEFAULT_SIGNATORIES: GradeSheetSignatories = {
  signedName: "Mr. James M. Kaye",
  signedTitle: "Dean of Admissions & Records",
  approvedName: "Mr. Justin M. Kanneh",
  approvedTitle: "Dean of Academic Affairs",
};

/** Names and titles are printed, not parsed -- the only rules are that they
 *  are non-empty and short enough to fit the signature line. */
const MAX_LENGTH = 80;

/**
 * Read-only, and deliberately not permission-gated: these four values are
 * printed on a document every role can already see, so they are no more
 * privileged than the College's own address. `institution_setting` is
 * readable through the superuser connection for the same reason
 * getGradingPolicy() reads it -- there is no per-user row here to scope.
 */
export async function getGradeSheetSignatories(): Promise<GradeSheetSignatories> {
  const rows = await db.query.institutionSetting.findMany({
    where: inArray(institutionSetting.key, Object.values(SIGNATORY_KEYS)),
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const read = (key: string, fallback: string): string => {
    const value = byKey.get(key);
    // jsonb, so a string arrives as a string -- anything else (a number, a
    // null, an object written by hand) falls back rather than printing
    // "[object Object]" on a document that leaves the building.
    return typeof value === "string" && value.trim() ? value : fallback;
  };

  return {
    signedName: read(SIGNATORY_KEYS.signedName, DEFAULT_SIGNATORIES.signedName),
    signedTitle: read(SIGNATORY_KEYS.signedTitle, DEFAULT_SIGNATORIES.signedTitle),
    approvedName: read(SIGNATORY_KEYS.approvedName, DEFAULT_SIGNATORIES.approvedName),
    approvedTitle: read(SIGNATORY_KEYS.approvedTitle, DEFAULT_SIGNATORIES.approvedTitle),
  };
}

/**
 * Changing who signs the sheet. Admin-only via
 * `institution.manageSignatories`, and audited -- this edits what a
 * document leaving the College asserts about who approved it, which is
 * exactly the kind of change Section 19.3 wants a trail for.
 *
 * All four values are written together, as one setting, because they are
 * one thing: a signature block with a name and no title, or a new dean's
 * name under the old dean's title, is worse than either alone.
 */
export async function updateGradeSheetSignatories(actor: Actor, input: GradeSheetSignatories) {
  await assertCan(actor, "institution.manageSignatories");

  const cleaned: GradeSheetSignatories = {
    signedName: input.signedName.trim(),
    signedTitle: input.signedTitle.trim(),
    approvedName: input.approvedName.trim(),
    approvedTitle: input.approvedTitle.trim(),
  };

  for (const [field, value] of Object.entries(cleaned)) {
    if (!value) throw new ValidationError("Every name and title on the signature block is required.");
    if (value.length > MAX_LENGTH) {
      throw new ValidationError(`"${field}" is too long — keep it under ${MAX_LENGTH} characters so it fits the signature line.`);
    }
  }

  const previous = await getGradeSheetSignatories();

  return db.transaction(async (tx) => {
    for (const [field, key] of Object.entries(SIGNATORY_KEYS)) {
      await tx
        .insert(institutionSetting)
        .values({
          key,
          value: cleaned[field as keyof GradeSheetSignatories],
          description: "Printed on the Student Grade Sheet signature block.",
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: institutionSetting.key,
          set: { value: cleaned[field as keyof GradeSheetSignatories], updatedBy: actor.userId, updatedAt: new Date() },
        });
    }

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "INSTITUTION_SETTING_UPDATED",
      entityType: "institution_setting",
      entityId: "grade_sheet_signatories",
      oldValue: previous,
      newValue: cleaned,
    });

    return cleaned;
  });
}
