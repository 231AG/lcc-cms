import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Stage 11's "health and monitoring endpoints" (plan Section 24.12
 * Backend scope). Deliberately unauthenticated and minimal -- a load
 * balancer or uptime check has no session, and this must never leak
 * anything beyond "is the database reachable." No academic data, no
 * counts, no version strings.
 */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", database: "reachable", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable", timestamp: new Date().toISOString() }, { status: 503 });
  }
}
