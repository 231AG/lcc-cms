import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/session";
import { getGradeSheet, trimCredits } from "@/lib/gradesheet/gradeSheet";
import { toCsv } from "@/lib/students/studentListRows";
import { AppError } from "@/lib/errors";

/**
 * One semester of the signed-in student's own results, as CSV.
 *
 * A plain GET route rather than a Server Action, for the same reason the
 * students and semester exports are: only a real response can carry the
 * Content-Type/Content-Disposition headers that make a browser save a file
 * instead of rendering it.
 *
 * It reads through getGradeSheet(), so the file holds exactly the six
 * columns and the same figures as the table on screen and the printed
 * sheet -- there is no second calculation here that could drift from them.
 *
 * Scoping is the student's own id, taken from the session and never from
 * the query string: there is no studentId parameter to tamper with, and
 * getGradeSheet reads through RLS on top of that.
 */

const COLUMNS = [
  { key: "title", header: "Course Title" },
  { key: "code", header: "Code" },
  { key: "creditHours", header: "Cr/Hrs" },
  { key: "letter", header: "Grade" },
  { key: "gradePoint", header: "Grade Point" },
  { key: "gradePoints", header: "Grade Points" },
] as const;

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const semesterId = new URL(request.url).searchParams.get("semesterId");
    if (!semesterId) throw new AppError("A semester is required.");

    const sheet = await getGradeSheet(actor, actor.userId, semesterId);

    const rows: Array<Record<string, string>> = sheet.courses.map((c) => ({
      title: c.isRepeatDropped ? `${c.title} (R)` : c.title,
      code: c.code,
      creditHours: c.creditHours,
      letter: c.letter,
      gradePoint: c.gradePoint ?? "",
      gradePoints: c.gradePoints ?? "",
    }));
    // The totals travel with the rows they are drawn from -- a results file
    // without them is not the thing that was on screen. Labelled in the
    // first column so a spreadsheet shows them as what they are.
    rows.push({ title: "" });
    rows.push({ title: "Total Credit Earned", creditHours: trimCredits(sheet.summary.creditsEarned) });
    rows.push({ title: "Total Grade Points", gradePoints: sheet.summary.totalGradePoints });
    rows.push({ title: "Semester GPA", gradePoints: sheet.summary.gpa ?? "" });

    const slug = `${sheet.academicYearLabel}-semester-${sheet.semesterNumeral}`.replace(/[^A-Za-z0-9]+/g, "-");
    const filename = `results-${sheet.student.studentNumber}-${slug}.csv`.toLowerCase();

    return new NextResponse(toCsv(COLUMNS, rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
