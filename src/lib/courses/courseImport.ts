import { asUser } from "@/lib/db/asUser";
import { course } from "@/lib/db/schema";
import { auditWrite } from "@/lib/audit/audit";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";
import { courseCodeKey } from "./courseCode";
import { parseCourseList, summarisePrefixes, type ParseProblem } from "./courseImportParse";

/**
 * Loading the College's course catalogue in one go.
 *
 * Eight hundred courses were never going to be typed in one at a time.
 * They exist as a PDF; the shape that survives copying out of one is a
 * pasted list, so that is what this takes.
 *
 * Two calls, deliberately. `previewCourseImport` reads and writes nothing
 * -- it says what the paste contains, what is already on record and which
 * subjects have nowhere to go. `commitCourseImport` is the only one that
 * writes, and it takes an explicit decision for every subject. Nobody
 * should find out what an 800-row import did by looking at the result.
 */

export interface PrefixPlan {
  prefix: string;
  count: number;
  /** A department whose code IS this prefix, if one exists. Suggested, not
   *  applied: the caller still has to choose it. */
  suggestedDepartmentId: string | null;
}

export interface PreviewRow {
  code: string;
  title: string;
  creditHours: number;
  prefix: string;
  /** Already on record, matched the way every other lookup matches. Such a
   *  row is skipped rather than updated: an import that quietly rewrote
   *  the title of a course students already hold grades in would be a
   *  worse outcome than doing nothing. */
  existing: { title: string; creditHours: number } | null;
}

export interface ImportPreview {
  rows: PreviewRow[];
  prefixes: PrefixPlan[];
  problems: ParseProblem[];
  duplicates: { code: string; keptTitle: string; alsoSeenTitles: string[] }[];
  totals: { parsed: number; alreadyOnRecord: number; newToUs: number };
}

export async function previewCourseImport(actor: Actor, text: string): Promise<ImportPreview> {
  await assertCan(actor, "structure.manageCourse");

  const parsed = parseCourseList(text);
  const [existingCourses, departments] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.course.findMany(), tx.query.department.findMany()]),
  );

  const byKey = new Map(existingCourses.map((c) => [courseCodeKey(c.code), c]));
  const rows: PreviewRow[] = parsed.courses.map((c) => {
    const found = byKey.get(courseCodeKey(c.code));
    return {
      code: c.code,
      title: c.title,
      creditHours: c.creditHours,
      prefix: c.prefix,
      existing: found ? { title: found.title, creditHours: found.creditHours } : null,
    };
  });

  const departmentByCode = new Map(departments.map((d) => [d.code.trim().toUpperCase(), d.id]));
  const prefixes: PrefixPlan[] = summarisePrefixes(parsed.courses).map((p) => ({
    ...p,
    suggestedDepartmentId: departmentByCode.get(p.prefix) ?? null,
  }));

  const alreadyOnRecord = rows.filter((r) => r.existing).length;
  return {
    rows,
    prefixes,
    problems: parsed.problems,
    duplicates: parsed.duplicates.map((d) => ({
      code: d.code,
      keptTitle: d.kept.title,
      alsoSeenTitles: d.alsoSeen.map((c) => c.title),
    })),
    totals: { parsed: rows.length, alreadyOnRecord, newToUs: rows.length - alreadyOnRecord },
  };
}

export interface CommitCourseImportInput {
  text: string;
  /** Subject prefix -> the department its courses belong to. A prefix left
   *  out, or mapped to "", has its courses skipped. There is no default:
   *  which department a subject belongs to is the College's decision, and
   *  a guess repeated 800 times is 800 wrong rows. */
  departmentByPrefix: Record<string, string>;
}

export interface ImportResult {
  created: number;
  skippedExisting: number;
  skippedUnmapped: number;
  /** Codes the database refused, with why. Reported rather than thrown:
   *  one bad row out of 800 should not cost the other 799. */
  failed: { code: string; reason: string }[];
}

/**
 * Writes the courses.
 *
 * One transaction for the lot. An import that half-succeeded would leave
 * nobody able to say what is on record without reading all 800 rows, and
 * re-running it would be a guess. Either the catalogue loaded or it did
 * not.
 *
 * Rows already on record are skipped, not updated. Rows whose subject has
 * no department are skipped. Both are counted and returned, because the
 * only honest end to an 800-row operation is a number for every row.
 */
export async function commitCourseImport(actor: Actor, input: CommitCourseImportInput): Promise<ImportResult> {
  await assertCan(actor, "structure.manageCourse");

  const parsed = parseCourseList(input.text);
  if (parsed.courses.length === 0) throw new ValidationError("There are no courses in that list.");

  const [existingCourses, departments] = await asUser(actor.userId, (tx) =>
    Promise.all([tx.query.course.findMany(), tx.query.department.findMany()]),
  );
  const existingKeys = new Set(existingCourses.map((c) => courseCodeKey(c.code)));
  const departmentIds = new Set(departments.map((d) => d.id));

  // Every mapping is checked before anything is written. A department id
  // that does not exist would otherwise surface as a foreign key violation
  // several hundred rows in.
  for (const [prefix, departmentId] of Object.entries(input.departmentByPrefix)) {
    if (departmentId && !departmentIds.has(departmentId)) {
      throw new ValidationError(`The department chosen for ${prefix} no longer exists.`);
    }
  }

  const result: ImportResult = { created: 0, skippedExisting: 0, skippedUnmapped: 0, failed: [] };
  const toCreate: { departmentId: string; code: string; title: string; creditHours: number }[] = [];

  for (const c of parsed.courses) {
    if (existingKeys.has(courseCodeKey(c.code))) {
      result.skippedExisting++;
      continue;
    }
    const departmentId = input.departmentByPrefix[c.prefix];
    if (!departmentId) {
      result.skippedUnmapped++;
      continue;
    }
    if (!Number.isInteger(c.creditHours) || c.creditHours <= 0) {
      result.failed.push({ code: c.code, reason: "Credit hours must be a whole number above zero." });
      continue;
    }
    toCreate.push({ departmentId, code: c.code, title: c.title, creditHours: c.creditHours });
  }

  if (toCreate.length === 0) return result;

  await asUser(actor.userId, async (tx) => {
    // One statement rather than 800. The unique index on the code is the
    // backstop, and it applies to the whole insert.
    const inserted = await tx.insert(course).values(toCreate).returning();
    result.created = inserted.length;

    // One audit entry for the operation, not one per course. Eight hundred
    // entries would bury the log that an auditor actually reads, and the
    // event here is "the catalogue was loaded", which happened once.
    await auditWrite(tx, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "COURSE_IMPORTED",
      entityType: "course",
      entityId: inserted[0].id,
      newValue: {
        created: inserted.length,
        codes: inserted.map((c) => c.code),
        departments: [...new Set(toCreate.map((c) => c.departmentId))],
      },
    });
  });

  return result;
}

/** Departments, for the mapping step. Its own read so the import screen
 *  does not have to reach into the structure service for one list. */
export async function listDepartmentsForImport(actor: Actor) {
  await assertCan(actor, "structure.manageCourse");
  return asUser(actor.userId, (tx) =>
    tx.query.department.findMany({
      where: (d, { eq }) => eq(d.isActive, true),
      orderBy: (d, { asc }) => asc(d.code),
    }),
  );
}

export type { ParseProblem };
