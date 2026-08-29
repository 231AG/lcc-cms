import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/session";
import { runSemesterExport, toCsv } from "@/lib/export/academicExport";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";

/**
 * The request-scoped streaming download of Section 8.4's "no scheduled
 * processing" model: a plain GET, not a Server Action, because a Server
 * Action can't hand back a file with its own Content-Type/Content-
 * Disposition headers. The response body is small enough at Phase 1's
 * scale (ASM-03) to build in memory rather than a true chunked stream.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ semesterId: string }> }) {
  const { semesterId } = await params;

  try {
    const actor = await requireActor();
    const { semesterLabel, rows } = await runSemesterExport(actor, semesterId);
    const csv = toCsv(rows);
    const filename = `academic-export-${semesterLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
