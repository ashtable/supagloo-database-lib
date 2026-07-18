import { defineConfig } from "vitest/config";

// Unit config: pure-logic tests only (no DB, no network). Fast.
// Colocated as src/**/*.test.ts. E2E lives under tests/e2e/*.e2e.ts and runs
// via vitest.e2e.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
  },
});
