import { config } from "dotenv";

// Integration tests run against the real local Postgres started by
// docker-compose.yml (plan Section 23.1: "row-level security, check
// constraints, transaction isolation ... cannot be tested against a mock").
config({ path: ".env.local" });
