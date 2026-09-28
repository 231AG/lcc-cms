import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/session";
import { runSemesterResultsExport } from "@/lib/export/academicExport";
import { semesterResultsCsv } from "@/lib/export/semesterExportRows";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";

/**
 * The semester-results file: one row per student -- semester GPA, CGPA as
 * at the end of the semester, credits and standing. A plain GET for the
 * same reason as the course-grades route beside it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ semesterId: string }> }) {
  const { semesterId } = await params;

  try {
    const actor = await requireActor();
    const { context, rows } = await runSemesterResultsExport(actor, semesterId, "CSV");

    return new NextResponse(semesterResultsCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="semester-results-${context.fileSlug}.csv"`,
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
