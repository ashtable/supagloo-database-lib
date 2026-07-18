---
name: check-prisma-version-tool
description: How the consumer-side check-prisma-version enforcement tool works (shape, pass/fail policy, why missing is tolerated)
metadata:
  type: decision
---

`@supagloo/database-lib` ships a `check-prisma-version` enforcement tool (Task #2,
2026-07-17) so consumers (API/DBOS) can gate — in CI or a postinstall — that they
pin BOTH `prisma` and `@prisma/client` to the EXACT same version as the lib. It
enforces the §9-Q11 release gate. See [[database-lib-build-architecture]] and the
root supagloo repo's `prisma-exact-version-pin` memory.

**Shape (two modules, both dependency-free — only node builtins + the
dependency-free `PRISMA_VERSION`, so a postinstall never loads the heavy client):**
- `src/check-prisma-version.ts` — pure/injectable logic: `checkPrismaVersion(pkg,
  expected=PRISMA_VERSION)`, `classifySpec`, `formatReport`, and
  `runCli({cwd, argv?, expected?, log, error}): number` (I/O injected → unit-testable
  in-process). `runCli` reads `<cwd>/package.json` (or `argv[0]` dir/file), fails
  closed (exit 1) on unreadable/invalid JSON.
- `src/check-prisma-version.cli.ts` — thin `#!/usr/bin/env node` shim; sets
  `process.exitCode = runCli(...)`. **tsc preserves the shebang** into
  `dist/check-prisma-version.cli.js` (verified) — no hand-written JS bin needed.

**Wiring in package.json:** `bin: { "check-prisma-version":
"dist/check-prisma-version.cli.js" }` (npm links it into consumers'
`node_modules/.bin` → `npx check-prisma-version`), plus a `./check-prisma-version`
subpath export for programmatic `import { checkPrismaVersion }`. No `files` change
(dist already ships). **No `postinstall` in the lib itself** — it's the source of
truth, it does not check itself; consumers wire the invocation (tasks 8/15).

**Pass/fail policy — inspects the *declared* spec string, never node_modules.**
Per package status: `ok` (exact `x.y.z` == pin) / `drift` (exact but different) /
`range` (anything not matching `/^\d+\.\d+\.\d+$/` — carets, `~`, `*`, `>=`,
partial `7.8`, tags, `=7.8.0`, prereleases, urls) / `missing`. **Overall FAILS iff
any is `range` or `drift`; `missing` is tolerated (still exit 0).**
**Why missing is tolerated (principled, not a shortcut):** the hazard is drift /
dual-install, which requires a *declared* spec. An undeclared `@prisma/client`
resolves transitively from the lib at the exact pin (no drift possible); a consumer
that never runs the `prisma` CLI shouldn't be forced to add a devDependency. A
future task can flip to strict "must declare" trivially — the finding already
carries the `missing` status. Reuses the exact-semver regex convention; **no
`semver` dependency added.**

**Tests:** unit `src/check-prisma-version.test.ts` (inline spec-classification
table + 6 static consumer fixtures under `tests/fixtures/consumers/*/package.json`
+ `runCli` exit codes; pure-fn tests pass an explicit `expected` to stay decoupled
from the live pin). E2E `tests/e2e/check-prisma-version.e2e.ts` follows the
`pack-install` pattern: build → `npm pack` → install tarball with `--no-save` into
one scratch consumer (so npm doesn't rewrite our pins; the checker only reads
package.json text, so we install once and rewrite pins between scenarios) → run the
real linked `.bin` via `spawnSync` → matched exit 0, drift/range exit 1.
**Stagehand/browser e2e is N/A — pure backend CLI, no UI.**
