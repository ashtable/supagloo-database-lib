#!/usr/bin/env node
/**
 * Executable entry for the `check-prisma-version` bin. Thin shim over
 * {@link runCli} — wires real process I/O and sets the exit code. Consumers run
 * this via `npx check-prisma-version` or `node_modules/.bin/check-prisma-version`
 * in CI / a postinstall hook.
 */
import { runCli } from "./check-prisma-version";

process.exitCode = runCli({
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  log: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
});
