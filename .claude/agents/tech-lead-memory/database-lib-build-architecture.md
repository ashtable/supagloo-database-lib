---
name: database-lib-build-architecture
description: How @supagloo/database-lib builds and ships its Prisma client (Prisma 7 generator, CJS tsc, dep layout, gotchas)
metadata:
  type: decision
---

`@supagloo/database-lib` is a **pure library** (no runtime service) that ships a
compiled Prisma client. Bootstrapped in Task #1 (2026-07-17). Build pipeline:
`prisma generate && tsc -p tsconfig.json` → `dist/`.

**Prisma pin: exact `7.8.0`** for both `prisma` and `@prisma/client`. Single
source of truth is `src/prisma-version.ts` (`export const PRISMA_VERSION`). Kept
in its own dependency-free module so the self-consistency test never loads the
heavy generated client. Invariant (unit-tested in `src/prisma-version.test.ts`):
`PRISMA_VERSION === package.json supagloo.prismaVersion === dependencies["@prisma/client"]
=== devDependencies["prisma"]`, each an exact `x.y.z`.

**Why these specific choices (all verified empirically, not from memory):**

- **Generator = `prisma-client`** (NOT legacy `prisma-client-js`). Prisma 7's
  `prisma-client` generator emits **TypeScript source** into `output`, which our
  own `tsc` compiles into `dist/` — the clean pattern for a library that ships its
  client. Config: `moduleFormat = "cjs"`, `importFileExtension = ""`,
  `runtime = "nodejs"`, `output = "../src/generated/prisma"`. This yields
  extensionless relative imports and no `import.meta.url`, so it compiles under
  `tsc module:commonjs / moduleResolution:node`. (Default ESM mode emits `.ts`
  import extensions + `import.meta` which break an emitting CJS tsc build.)
- **Module format = CommonJS** via plain `tsc` (no bundler). Simplest and most
  universally consumable (Node/DBOS/Next.js). Reversible: an ESM conditional
  export can be added later without breaking CJS consumers.
- **`@prisma/client` is a runtime `dependency`**, `prisma` (CLI) is a
  `devDependency`. The generated client imports `@prisma/client/runtime/client`
  at runtime, so consumers must get `@prisma/client` transitively.

**Gotchas / constraints:**

- **Prisma 7 datasource has NO `url`.** `url = env(...)` in `datasource db {}` is a
  hard validation error (P1012). Connection config moves to a driver adapter at
  runtime / `prisma.config.ts` for the CLI. Minimal schema is just
  `provider = "postgresql"`. `prisma generate` needs no DB and no config file.
- **`src/generated/` is gitignored** (build artifact). Consequence: `prisma
  generate` MUST run before the unit suite, because `src/index.ts` re-exports
  `./generated/prisma/client`. **Resolved (2026-07-17, Task #1 revision):** the
  test scripts now self-provision via npm pre-hooks — `pretest`, `pretest:unit`,
  and `pretest:e2e` each run `prisma generate` (npm auto-runs `pre<script>`
  before `<script>`). So `npm test` / `test:unit` / `test:e2e` work on a fresh
  checkout with no prior build. `prisma generate` here is offline and
  ~milliseconds (zero-model schema, no DB/network). Repro of the old failure:
  `rm -rf dist src/generated && npm run test:unit` was exit 1
  (`Cannot find module './generated/prisma/client'`); now Green.
- **`files: ["dist", "prisma"]`** ships `dist/**` in the npm tarball even though
  `dist` is gitignored — the `files` allowlist overrides `.gitignore` (verified
  via `npm pack`). Without an allowlist, npm falls back to `.gitignore` and would
  drop `dist`.
- Package is `private: true` (distributed via git submodule + `file:` dep, not the
  npm registry). `npm pack`/`file:` installs still work; only `npm publish` is
  blocked. Flip this if real registry publishing is ever wanted.

Test layout follows the `supagloo-nextjs` convention: `vitest.config.ts` (unit,
`src/**/*.test.ts`) + `vitest.e2e.config.ts` (e2e, `tests/e2e/**/*.e2e.ts`, long
timeouts, `fileParallelism:false`). The e2e (`tests/e2e/pack-install.e2e.ts`) is a
real proof: build → `npm pack` → install tarball into a scratch consumer →
`require()` + `tsc --noEmit` the shipped types.

Related: the consumer-side enforcement (`check-prisma-version`, later task #2) is
described in the root supagloo repo's `prisma-exact-version-pin` memory.
