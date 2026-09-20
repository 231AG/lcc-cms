import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { getStudentPhoto } from "@/lib/students/photo";

/**
 * Serves one student's photograph.
 *
 * There is no ownership check in this handler, and that is deliberate
 * rather than an omission: `getStudentPhoto` reads through `asUser()`, so
 * Postgres's row-level security is what decides whether these bytes exist
 * for this caller (migration 0028: a student sees `student_id =
 * auth.uid()`, staff see all). A student who edits the id in the URL gets
 * the same 404 as a student who does not exist. Adding a second check here
 * would not make that safer -- it would just make it look like the check
 * was the thing keeping it safe.
 *
 * Cached `private, max-age=300`: private because this is one person's
 * photograph and a shared cache must never hold it, and short because an
 * Admin who replaces a photo should see the new one without being told to
 * hard-refresh. `must-revalidate` so a stale entry is never served after
 * it expires.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const photo = await getStudentPhoto(actor, id);
  if (!photo) return new NextResponse(null, { status: 404 });

  // Uint8Array rather than the Buffer: BodyInit accepts the former across
  // every runtime this may end up on, and the bytes are identical.
  return new NextResponse(new Uint8Array(photo.data), {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.byteSize),
      "Cache-Control": "private, max-age=300, must-revalidate",
      // The stored type is sniffed from the bytes, never taken from the
      // upload's claim -- but nosniff costs nothing and means a browser
      // cannot decide to reinterpret it either.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
