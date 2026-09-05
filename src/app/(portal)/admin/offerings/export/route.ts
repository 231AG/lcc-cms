import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/session";
import { OFFERING_COLUMNS } from "@/lib/offerings/offeringRows";
import { toCsv } from "@/lib/students/studentListRows";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { getFilteredOfferingRows } from "../offeringFilters";

/**
 * The offerings table as CSV -- the same rows, the same twelve columns plus
 * instructor and status, honouring the semester, college filter and search
 * currently applied. A GET route rather than a Server Action, so the browser
 * gets real Content-Disposition headers and saves a file.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("Not available to your role.");
    }

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    if (!params.semesterId) throw new ValidationError("Choose a semester before downloading.");

    const { rows, semesterLabel } = await getFilteredOfferingRows(actor, params);
    const csv = toCsv(OFFERING_COLUMNS, rows);
    const slug = semesterLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "semester";

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="course-offerings-${slug}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
