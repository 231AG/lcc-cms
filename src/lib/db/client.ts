import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Server-only database connection. Never import this module from client
 * components — the browser must never hold a database credential capable
 * of writing academic data (plan Section 8.1, principle P1).
 *
 * Uses the pooler in transaction mode when pointed at Supabase, per the
 * plan's Stage 1 requirement to prove pooled multi-statement transactions
 * behave correctly before anything depends on them.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export type Database = typeof db;

/**
 * The transaction-scoped handle passed into `db.transaction(async (tx) => ...)`.
 * Every service operation that writes more than one row takes this type, not
 * `Database`, so it is impossible to accidentally issue a write outside the
 * caller's transaction (plan principle P5, DER-21).
 */
export type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]
>[0];

