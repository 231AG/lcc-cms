import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asUser } from "@/lib/db/asUser";
import { studentPhoto } from "@/lib/db/schema";
import { assertCan } from "@/lib/permissions/kernel";
import type { Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";
import { auditWrite } from "@/lib/audit/audit";
import { MAX_PHOTO_BYTES, sniffImageType, type PhotoContentType } from "./imageFormat";

/**
 * Student photographs: upload, fetch, remove.
 *
 * Reads go through `asUser()` so row-level security decides what comes
 * back -- a student can fetch their own photo and nobody else's, and that
 * is Postgres's rule, not an if-statement here (see 0028's policies).
 * Writes use the superuser connection behind `assertCan` plus an audit
 * record, which is the same DEV-03 pattern as every other student write.
 *
 * Uploading is gated on `identity.updateStudentProfile`, which today only
 * ADMIN holds. No new permission row, so nothing can fail closed on a
 * database that has not been reseeded.
 *
 * The format and size rules live in ./imageFormat, a pure module this one
 * re-exports.
 *
 * No `import "server-only"` here, matching every other service in
 * src/lib/: only auth/session.ts and supabase/server.ts carry that marker.
 * It would add nothing -- this file imports the Postgres client, which
 * cannot be bundled for the browser regardless -- and it is not free,
 * because the marker throws under vitest and would cost the cross-student
 * isolation test that covers these very functions.
 */

export { MAX_PHOTO_BYTES, ACCEPTED_PHOTO_TYPES, sniffImageType } from "./imageFormat";
export type { PhotoContentType } from "./imageFormat";


export interface StudentPhotoView {
  contentType: PhotoContentType;
  byteSize: number;
  data: Buffer;
  uploadedAt: Date;
}

/**
 * One student's photo, or null if they have none.
 *
 * Read as the actor, so a STUDENT asking for another student's id gets
 * nothing back from Postgres regardless of what this function does. The
 * serve route depends on that: it has no ownership check of its own.
 */
export async function getStudentPhoto(actor: Actor, studentId: string): Promise<StudentPhotoView | null> {
  const row = await asUser(actor.userId, (tx) =>
    tx.query.studentPhoto.findFirst({ where: eq(studentPhoto.studentId, studentId) }),
  );
  if (!row) return null;
  return {
    contentType: row.contentType as PhotoContentType,
    byteSize: row.byteSize,
    data: row.data,
    uploadedAt: row.uploadedAt,
  };
}

/**
 * Whether a student has a photo and when it was uploaded, without pulling
 * the bytes.
 *
 * The profile screens need this to choose between an `<img>` and the
 * initials fallback; loading a megabyte to answer a yes/no would be
 * wasteful on a page that then makes the browser fetch it again anyway.
 * The timestamp is what the avatar hangs its cache-buster on, so replacing
 * a photo shows the new one instead of the five-minute-old one.
 */
export async function getStudentPhotoMeta(
  actor: Actor,
  studentId: string,
): Promise<{ uploadedAt: Date } | null> {
  const row = await asUser(actor.userId, (tx) =>
    tx.query.studentPhoto.findFirst({
      where: eq(studentPhoto.studentId, studentId),
      columns: { uploadedAt: true },
    }),
  );
  return row ? { uploadedAt: row.uploadedAt } : null;
}

/**
 * Store or replace a student's photo.
 *
 * `declaredType` is accepted only so the refusal message can mention what
 * was sent; the stored type is always the sniffed one.
 */
export async function setStudentPhoto(
  actor: Actor,
  studentId: string,
  bytes: Uint8Array,
  declaredType?: string,
): Promise<void> {
  await assertCan(actor, "identity.updateStudentProfile");

  if (bytes.length === 0) throw new ValidationError("That file is empty.");
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new ValidationError(
      `That photo is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The largest accepted is 2 MB.`,
    );
  }

  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new ValidationError(
      declaredType
        ? `That file is not a JPEG, PNG or WebP image (it arrived as ${declaredType}).`
        : "That file is not a JPEG, PNG or WebP image.",
    );
  }

  const data = Buffer.from(bytes);

  await db.transaction(async (tx) => {
    const existing = await tx.query.studentPhoto.findFirst({
      where: eq(studentPhoto.studentId, studentId),
      columns: { studentId: true, contentType: true, byteSize: true },
    });

    await tx
      .insert(studentPhoto)
      .values({ studentId, contentType, byteSize: data.length, data, uploadedBy: actor.userId })
      .onConflictDoUpdate({
        target: studentPhoto.studentId,
        set: { contentType, byteSize: data.length, data, uploadedBy: actor.userId, uploadedAt: new Date() },
      });

    // The bytes themselves are deliberately NOT in the audit record -- an
    // append-only log is the last place to duplicate a megabyte per edit.
    // What it records is who changed whose photo, when, and to what shape.
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: existing ? "STUDENT_PHOTO_REPLACED" : "STUDENT_PHOTO_UPLOADED",
      entityType: "student_photo",
      entityId: studentId,
      studentId,
      oldValue: existing ? { contentType: existing.contentType, byteSize: existing.byteSize } : null,
      newValue: { contentType, byteSize: data.length },
    });
  });
}

/** Remove a student's photo. A no-op if they have none. */
export async function removeStudentPhoto(actor: Actor, studentId: string): Promise<void> {
  await assertCan(actor, "identity.updateStudentProfile");

  await db.transaction(async (tx) => {
    const existing = await tx.query.studentPhoto.findFirst({
      where: eq(studentPhoto.studentId, studentId),
      columns: { studentId: true, contentType: true, byteSize: true },
    });
    if (!existing) return;

    await tx.delete(studentPhoto).where(eq(studentPhoto.studentId, studentId));

    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "STUDENT_PHOTO_REMOVED",
      entityType: "student_photo",
      entityId: studentId,
      studentId,
      oldValue: { contentType: existing.contentType, byteSize: existing.byteSize },
      newValue: null,
    });
  });
}
