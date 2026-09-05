import { asUser } from "@/lib/db/asUser";
import type { Actor } from "@/lib/permissions/kernel";
import { filterOfferingRows, getOfferingRows, type OfferingRow } from "@/lib/offerings/offeringRows";

/**
 * The offerings view's data, resolved the same way for the screen, the CSV
 * download and the print view -- so a downloaded timetable is the timetable
 * that was on screen, filters and all.
 */
export interface OfferingViewParams {
  semesterId?: string;
  q?: string;
  collegeId?: string;
  page?: string;
}

export async function getFilteredOfferingRows(
  actor: Actor,
  params: OfferingViewParams,
): Promise<{ rows: OfferingRow[]; semesterLabel: string; collegeLabel?: string }> {
  if (!params.semesterId) return { rows: [], semesterLabel: "" };

  const [rows, reference] = await Promise.all([
    getOfferingRows(actor, params.semesterId),
    asUser(actor.userId, (tx) =>
      Promise.all([
        tx.query.semester.findFirst({ where: (s, { eq }) => eq(s.id, params.semesterId!) }),
        tx.query.academicYear.findMany(),
        tx.query.college.findMany(),
      ]),
    ),
  ]);
  const [semester, years, colleges] = reference;

  const year = semester ? years.find((y) => y.id === semester.academicYearId) : undefined;
  const college = params.collegeId ? colleges.find((c) => c.id === params.collegeId) : undefined;
  const collegeLabel = college ? `${college.code} — ${college.name}` : undefined;

  return {
    rows: filterOfferingRows(rows, params.q, params.collegeId, collegeLabel),
    semesterLabel: semester && year ? `${year.label} — ${semester.name}` : "",
    collegeLabel,
  };
}

/** What is being shown, in a sentence, for the printed subtitle. */
export function describeOfferingFilters(semesterLabel: string, q?: string, collegeLabel?: string): string {
  const parts = [semesterLabel || "No semester selected"];
  if (collegeLabel) parts.push(collegeLabel);
  if (q) parts.push(`matching “${q}”`);
  return parts.join(" · ");
}
