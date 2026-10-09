/* eslint-disable @typescript-eslint/no-explicit-any -- throw-away local test helper */
import { db } from "../../../src/lib/db/client";
import { recomputeStudentSummaries } from "../../../src/lib/gpa/recompute";
import { sql } from "drizzle-orm";
async function main() {
  const r = await db.execute(sql`select id from app.app_user where login_identifier='2026999'`);
  const id = (r as any)[0].id;
  await db.transaction(async (tx) => { await recomputeStudentSummaries(tx as any, id); });
  console.log("recomputed", id); process.exit(0);
}
main();
