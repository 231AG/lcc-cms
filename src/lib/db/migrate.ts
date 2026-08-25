import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client);

  console.log("Applying migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
