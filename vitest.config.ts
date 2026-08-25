import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    // Integration tests share one live, stateful external database
    // (Supabase). Several suites create their own temporary Super Admin
    // fixtures (e.g. realSuperAdminActor() in accounts.integration.test.ts)
    // and race against each other's cleanup when files run in parallel --
    // caught by hand as a real flaky-FK-constraint failure while building
    // Stage 2. Sequential is slower but correct; there is no disposable
    // per-file database to isolate against here.
    fileParallelism: false,
    // Real network round-trips to a hosted Postgres/Auth service, not a
    // local mock -- the default 5s budget is too tight under load, and a
    // few structure tests chain 10+ sequential writes (college, dept,
    // multiple courses, prerequisites, cleanup).
    testTimeout: 40_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
