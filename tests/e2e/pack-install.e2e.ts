import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Repo root = two levels up from tests/e2e/.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as { supagloo?: { prismaVersion?: string } };
const EXPECTED_VERSION = pkg.supagloo?.prismaVersion;

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

describe("e2e: npm pack -> scratch consumer install -> import from dist", () => {
  let scratch: string;
  let packDir: string;
  let tarball: string;

  beforeAll(() => {
    // 1. Build the library (prisma generate + tsc) so dist/ exists.
    run(npm, ["run", "build"], REPO_ROOT);

    // 2. Real `npm pack` into a temp dir; capture the produced tarball name.
    packDir = mkdtempSync(join(tmpdir(), "supagloo-dblib-pack-"));
    const packJson = run(
      npm,
      ["pack", "--pack-destination", packDir, "--json"],
      REPO_ROOT,
    );
    const filename = (JSON.parse(packJson) as Array<{ filename: string }>)[0]
      .filename;
    tarball = join(packDir, filename);

    // 3. Fresh scratch consumer that installs the tarball (+ typescript for the
    //    types check). This pulls @prisma/client transitively.
    scratch = mkdtempSync(join(tmpdir(), "supagloo-dblib-consumer-"));
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify(
        { name: "scratch-consumer", version: "1.0.0", private: true },
        null,
        2,
      ),
    );
    run(
      npm,
      ["install", tarball, "typescript@5", "--no-audit", "--no-fund"],
      scratch,
    );
  });

  afterAll(() => {
    for (const dir of [scratch, packDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ships the compiled type declarations in dist", () => {
    // Direct evidence the .d.ts made it into the installed package.
    const dts = join(
      scratch,
      "node_modules",
      "@supagloo",
      "database-lib",
      "dist",
      "index.d.ts",
    );
    expect(() => readFileSync(dts, "utf8")).not.toThrow();
  });

  it("imports PRISMA_VERSION and PrismaClient at runtime from dist", () => {
    writeFileSync(
      join(scratch, "consumer.cjs"),
      [
        'const lib = require("@supagloo/database-lib");',
        'if (typeof lib.PRISMA_VERSION !== "string") throw new Error("PRISMA_VERSION not a string");',
        'if (typeof lib.PrismaClient !== "function") throw new Error("PrismaClient not a function");',
        "process.stdout.write(JSON.stringify({ version: lib.PRISMA_VERSION, prismaClient: typeof lib.PrismaClient }));",
      ].join("\n"),
    );
    const out = run("node", ["consumer.cjs"], scratch);
    const result = JSON.parse(out) as {
      version: string;
      prismaClient: string;
    };
    expect(result.prismaClient).toBe("function");
    expect(result.version).toBe(EXPECTED_VERSION);
  });

  it("resolves the shipped types via tsc --noEmit in the consumer", () => {
    writeFileSync(
      join(scratch, "consumer.ts"),
      [
        'import { PRISMA_VERSION, PrismaClient } from "@supagloo/database-lib";',
        "export const version: string = PRISMA_VERSION;",
        "export const Client = PrismaClient;",
      ].join("\n"),
    );
    writeFileSync(
      join(scratch, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            module: "commonjs",
            moduleResolution: "node",
            target: "ES2022",
            esModuleInterop: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
          },
          files: ["consumer.ts"],
        },
        null,
        2,
      ),
    );
    // Throws (non-zero exit) if the types don't resolve from dist.
    expect(() =>
      run(join(scratch, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], scratch),
    ).not.toThrow();
  });
});
