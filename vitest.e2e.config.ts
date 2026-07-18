import { defineConfig } from "vitest/config";

// E2E config: real end-to-end packaging proof. Builds the library, runs a real
// `npm pack`, installs the tarball into a scratch consumer, and imports the
// client/types from `dist` in a separate process. Shells out via child_process,
// so timeouts are long (build + npm install of @prisma/client) and files run
// one at a time.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
