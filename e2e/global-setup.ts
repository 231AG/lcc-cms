import { config } from "dotenv";

/**
 * Loads .env.local into process.env before any test file's top-level
 * imports run. Doing this inside a test file itself doesn't work: ESM
 * import statements are hoisted above other code regardless of source
 * order, so modules like db/client.ts that read process.env at import
 * time would already have executed (and thrown) before an in-file
 * `config()` call had a chance to run.
 */
export default function globalSetup() {
  config({ path: ".env.local" });
}
