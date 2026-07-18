/**
 * Consumer-side Prisma pin enforcement for @supagloo/database-lib.
 *
 * The library ships a Prisma client that is version-coupled to a single exact
 * Prisma version (see {@link PRISMA_VERSION}). Every consumer (API, DBOS) MUST
 * pin BOTH `prisma` and `@prisma/client` to that EXACT version — never a semver
 * range — or a drift silently breaks consumers at runtime. This module is the
 * enforcement gate consumers run in CI / a postinstall hook via the
 * `check-prisma-version` bin.
 *
 * We inspect the consumer's *declared* dependency spec strings (not the resolved
 * versions in node_modules): a caret that happens to resolve correctly today can
 * drift tomorrow, so a range is a failure even when it currently matches.
 *
 * Kept dependency-free (only node builtins + the dependency-free
 * {@link PRISMA_VERSION} module) so a postinstall never loads the heavy
 * generated client.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PRISMA_VERSION } from "./prisma-version";

/** Exact-pin form `x.y.z` — the established convention (prisma-version.test.ts). */
export const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

/** The two packages whose versions must stay coupled to the shipped client. */
export const PRISMA_PACKAGES = ["prisma", "@prisma/client"] as const;
export type PrismaPackageName = (typeof PRISMA_PACKAGES)[number];

/** package.json sections scanned for a declaration, in precedence order. */
export const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
export type DepSection = (typeof DEP_SECTIONS)[number];

export type PinStatus =
  | "ok" // exact spec equal to the required version
  | "drift" // exact spec, but a different version
  | "range" // not an exact pin (range, wildcard, tag, url, partial version)
  | "missing"; // not declared by the consumer at all

export interface PinFinding {
  name: PrismaPackageName;
  status: PinStatus;
  /** The declared spec string, if any. */
  spec?: string;
  /** Which package.json section it was declared in, if any. */
  declaredIn?: DepSection;
}

export interface CheckResult {
  /** true iff no package is `range` or `drift` (`missing` is tolerated). */
  ok: boolean;
  /** The exact version every declared pin was required to equal. */
  expected: string;
  /** The consuming package's `name`, if present. */
  consumerName?: string;
  findings: PinFinding[];
}

export type DependencyMap = Record<string, string>;

export interface PackageJsonLike {
  name?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
}

/** Classify a single declared spec against the required exact version. */
export function classifySpec(spec: string, expected: string): PinStatus {
  if (!EXACT_SEMVER.test(spec)) return "range";
  return spec === expected ? "ok" : "drift";
}

/** Find the first declaration of `name` across the dependency sections. */
function findDeclaration(
  pkg: PackageJsonLike,
  name: string,
): { spec: string; declaredIn: DepSection } | undefined {
  for (const section of DEP_SECTIONS) {
    const spec = pkg[section]?.[name];
    if (typeof spec === "string") return { spec, declaredIn: section };
  }
  return undefined;
}

/**
 * Compare a consumer's package.json against the required exact Prisma version.
 * Pure and version-agnostic — the caller supplies `expected`.
 */
export function checkPrismaVersion(
  pkg: PackageJsonLike,
  expected: string = PRISMA_VERSION,
): CheckResult {
  const findings: PinFinding[] = PRISMA_PACKAGES.map((name) => {
    const decl = findDeclaration(pkg, name);
    if (!decl) return { name, status: "missing" as const };
    return {
      name,
      status: classifySpec(decl.spec, expected),
      spec: decl.spec,
      declaredIn: decl.declaredIn,
    };
  });

  const ok = !findings.some((f) => f.status === "range" || f.status === "drift");
  return { ok, expected, consumerName: pkg.name, findings };
}

/** Build a human-readable, actionable report for a check result. */
export function formatReport(result: CheckResult): string {
  const { expected } = result;

  if (result.ok) {
    const missing = result.findings
      .filter((f) => f.status === "missing")
      .map((f) => f.name);
    let text = `check-prisma-version: OK — Prisma is pinned to exactly ${expected}, matching @supagloo/database-lib.`;
    if (missing.length > 0) {
      const subject = missing.length > 1 ? "they" : "it";
      text += `\n  Note: ${missing.join(", ")} not declared directly; ${subject} will resolve transitively from @supagloo/database-lib at ${expected}.`;
    }
    return text;
  }

  const who = result.consumerName ? `"${result.consumerName}"` : "this package";
  const lines: string[] = [
    `check-prisma-version: FAILED for ${who}.`,
    `@supagloo/database-lib is built against Prisma ${expected} and requires every consumer to pin the EXACT same version for both "prisma" and "@prisma/client" (no ^, ~, or ranges).`,
    "",
  ];

  for (const f of result.findings) {
    if (f.status === "range") {
      lines.push(
        `  - ${f.name} (${f.declaredIn}): "${f.spec}" is a version range, not an exact pin. Change it to exactly "${expected}".`,
      );
    } else if (f.status === "drift") {
      lines.push(
        `  - ${f.name} (${f.declaredIn}): "${f.spec}" is pinned to a different version. Change it to exactly "${expected}".`,
      );
    }
  }

  lines.push(
    "",
    `Fix: set both "prisma" and "@prisma/client" to exactly "${expected}" in package.json (no ^, ~, or ranges), then delete node_modules and reinstall.`,
  );
  return lines.join("\n");
}

export interface RunCliOptions {
  /** Directory the consumer is running from (its package.json is read here). */
  cwd: string;
  /** Positional args; `argv[0]`, if given, overrides the target directory/file. */
  argv?: string[];
  /** Required version; defaults to the library's {@link PRISMA_VERSION}. */
  expected?: string;
  log: (message: string) => void;
  error: (message: string) => void;
}

function resolveTarget(cwd: string, arg?: string): string {
  if (!arg) return join(cwd, "package.json");
  const resolved = isAbsolute(arg) ? arg : join(cwd, arg);
  return resolved.endsWith("package.json")
    ? resolved
    : join(resolved, "package.json");
}

/**
 * CLI entry, with I/O injected so it is unit-testable in-process. Reads the
 * consumer package.json, runs the check, prints the report, and returns the
 * process exit code (0 pass, 1 fail). Fails closed (1) if package.json cannot
 * be read or parsed.
 */
export function runCli(opts: RunCliOptions): number {
  const expected = opts.expected ?? PRISMA_VERSION;
  const target = resolveTarget(opts.cwd, opts.argv?.[0]);

  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    opts.error(
      `check-prisma-version: could not read ${target} — run this from a package directory. (${(err as Error).message})`,
    );
    return 1;
  }

  let pkg: PackageJsonLike;
  try {
    pkg = JSON.parse(raw) as PackageJsonLike;
  } catch (err) {
    opts.error(
      `check-prisma-version: ${target} is not valid JSON — ${(err as Error).message}`,
    );
    return 1;
  }

  const result = checkPrismaVersion(pkg, expected);
  const report = formatReport(result);
  if (result.ok) {
    opts.log(report);
    return 0;
  }
  opts.error(report);
  return 1;
}
