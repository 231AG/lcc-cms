import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { appUser, auditLog, college as collegeTable, course, department as departmentTable } from "@/lib/db/schema";
import { commitCourseImport, previewCourseImport } from "../courseImport";
import type { Actor } from "@/lib/permissions/kernel";

/**
 * Loading a pasted catalogue.
 *
 * Eight hundred rows in one action is the kind of thing that is either
 * exactly right or quietly disastrous, and nobody re-reads 800 rows to
 * find out which. So: what it refuses, what it skips, and whether it says
 * so.
 */

const id = () => randomUUID();
const SUPER = id(), ADMIN = id();
const COLLEGE = id(), DEPT_A = id(), DEPT_B = id();
const EXISTING = id();
// Letters only, and no digits: a course code is letters then digits, so a
// prefix carrying a digit is not a code the parser will ever accept. (The
// first draft of this file sliced a UUID for uniqueness and spent a test
// run proving exactly that.)
const letters = (n: number) =>
  Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
const A = `IA${letters(3)}`;
const B = `IB${letters(3)}`;

const actorOf = (userId: string, role: Actor["role"]): Actor =>
  ({ userId, role, displayName: "t", mustChangePassword: false }) as Actor;
const admin = () => actorOf(ADMIN, "ADMIN");

const LIST = [
  `${A}101 | First Course | 3`,
  `${A}102 | Second Course | 2`,
  `${B}201 | Third Course | 4`,
  `${A}999 | Already On Record | 3`,
].join("\n");

describe("importing a pasted course list", () => {
  afterAll(async () => {
    await db.delete(course).where(eq(course.departmentId, DEPT_A));
    await db.delete(course).where(eq(course.departmentId, DEPT_B));
    await db.delete(auditLog).where(inArray(auditLog.actorUserId, [ADMIN, SUPER]));
    await db.delete(departmentTable).where(inArray(departmentTable.id, [DEPT_A, DEPT_B]));
    await db.delete(collegeTable).where(inArray(collegeTable.id, [COLLEGE]));
    await db.delete(appUser).where(inArray(appUser.id, [ADMIN]));
  });

  beforeAll(async () => {
    await db.insert(appUser).values([
      { id: SUPER, loginIdentifier: `sup-${SUPER}@lcc.edu`, displayName: "Super", role: "SUPER_ADMIN", status: "ACTIVE", mustChangePassword: false },
      { id: ADMIN, loginIdentifier: `adm-${ADMIN}@lcc.edu`, displayName: "Registrar", role: "ADMIN", status: "ACTIVE", mustChangePassword: false },
    ]);
    await db.insert(collegeTable).values({ id: COLLEGE, code: `IC-${COLLEGE.slice(0, 6)}`, name: "Import College", isActive: true });
    await db.insert(departmentTable).values([
      { id: DEPT_A, collegeId: COLLEGE, code: A, name: "Subject A", isActive: true },
      { id: DEPT_B, collegeId: COLLEGE, code: B, name: "Subject B", isActive: true },
    ]);
    await db.insert(course).values({
      id: EXISTING, departmentId: DEPT_A, code: `${A}999`, title: "The Title We Already Hold", creditHours: 3, isActive: true,
    });
  });

  it("previews without writing anything", async () => {
    const before = await db.query.course.findMany({ where: eq(course.departmentId, DEPT_A) });
    const preview = await previewCourseImport(admin(), LIST);

    expect(preview.totals).toEqual({ parsed: 4, alreadyOnRecord: 1, newToUs: 3 });
    // The department's code IS the subject prefix here, so it is offered --
    // as a suggestion the Admin still has to accept.
    expect(preview.prefixes.find((p) => p.prefix === A)?.suggestedDepartmentId).toBe(DEPT_A);

    const after = await db.query.course.findMany({ where: eq(course.departmentId, DEPT_A) });
    expect(after).toHaveLength(before.length);
  });

  it("skips a course already on record rather than rewriting its title", async () => {
    // Students hold grades against these rows. An import that quietly
    // renamed one would be a worse outcome than doing nothing at all.
    const result = await commitCourseImport(admin(), {
      text: LIST,
      departmentByPrefix: { [A]: DEPT_A, [B]: DEPT_B },
    });

    expect(result.created).toBe(3);
    expect(result.skippedExisting).toBe(1);
    expect(result.skippedUnmapped).toBe(0);

    const untouched = await db.query.course.findFirst({ where: eq(course.id, EXISTING) });
    expect(untouched?.title).toBe("The Title We Already Hold");
  });

  it("is idempotent -- running it again adds nothing", async () => {
    const again = await commitCourseImport(admin(), {
      text: LIST,
      departmentByPrefix: { [A]: DEPT_A, [B]: DEPT_B },
    });
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBe(4);
  });

  it("skips a subject with no department, and counts what it skipped", async () => {
    const result = await commitCourseImport(admin(), {
      text: `${A}301 | Mapped | 3\nZZZZ301 | Unmapped | 3`,
      departmentByPrefix: { [A]: DEPT_A },
    });
    expect(result.created).toBe(1);
    // Not silently dropped: an import that reports only its successes
    // leaves nobody able to say what happened to the rest.
    expect(result.skippedUnmapped).toBe(1);
  });

  it("writes one audit entry for the operation, not one per course", async () => {
    const entries = await db.query.auditLog.findMany({ where: eq(auditLog.actorUserId, ADMIN) });
    const imports = entries.filter((e) => e.action === "COURSE_IMPORTED");
    // Two commits created rows above; 800 entries per import would bury
    // the log an auditor actually reads.
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.length).toBeLessThan(10);
  });

  it("refuses a department that does not exist before writing a single row", async () => {
    const ghost = id();
    await expect(
      commitCourseImport(admin(), { text: `${A}401 | Ghost | 3`, departmentByPrefix: { [A]: ghost } }),
    ).rejects.toThrow(/no longer exists/i);
    const written = (await db.query.course.findMany({ where: eq(course.departmentId, DEPT_A) })).find(
      (c) => c.title === "Ghost",
    );
    expect(written).toBeUndefined();
  });

  it("refuses an empty list rather than reporting a successful import of nothing", async () => {
    await expect(commitCourseImport(admin(), { text: "   ", departmentByPrefix: {} })).rejects.toThrow(
      /no courses/i,
    );
  });

  it("will not let a Super Admin import", async () => {
    // REQ-R04 denies a Super Admin structure.manageCourse. A bulk path is
    // not a way around a permission.
    await expect(
      commitCourseImport(actorOf(SUPER, "SUPER_ADMIN"), {
        text: `${A}501 | Back Door | 3`,
        departmentByPrefix: { [A]: DEPT_A },
      }),
    ).rejects.toThrow(/Not available to your role/i);
    await expect(previewCourseImport(actorOf(SUPER, "SUPER_ADMIN"), LIST)).rejects.toThrow(
      /Not available to your role/i,
    );
  });
});
