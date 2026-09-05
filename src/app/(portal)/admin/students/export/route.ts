import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/session";
import { getStudentListRows, toCsv, STUDENT_LIST_COLUMNS } from "@/lib/students/studentListRows";
import { parseStudentFilters } from "../filters";
import { AppError, ForbiddenError } from "@/lib/errors";

/**
 * The Students listing as CSV.
 *
 * A plain GET route rather than a Server Action, for the same reason the
 * semester export is one: only a real response can carry the
 * Content-Type/Content-Disposition headers that make a browser save a file
 * instead of rendering it.
 *
 * It reads the SAME query string the listing does and runs it through the
 * SAME parser, so what downloads is what is on screen -- every filter and
 * the search box, across every page, not just the rows you can see and not
 * the whole unfiltered table either.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("Not available to your role.");
    }

    const url = new URL(request.url);
    const filters = parseStudentFilters(Object.fromEntries(url.searchParams));
    const { rows, truncated } = await getStudentListRows(actor, filters);

    const csv = toCsv(STUDENT_LIST_COLUMNS, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `students-${filters.hasFilters ? "filtered-" : ""}${stamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        // Surfaced as a header rather than a row in the file: a "…and 12
        // more" line inside a CSV would be parsed as data by every tool
        // that opens it.
        ...(truncated ? { "X-Export-Truncated": "true" } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
