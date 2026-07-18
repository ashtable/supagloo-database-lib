import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Repo root = two levels up from tests/e2e/.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as { supagloo?: { prismaVersion?: string } };
// Use the live pin so this e2e stays correct across future pin bumps.
const EXPECTED_VERSION = pkg.supagloo?.prismaVersion as string;

const [maj, min, pat] = EXPECTED_VERSION.split(".");
const DRIFTED_VERSION = `${Number(maj) + 1}.${min}.${pat}`; // exact but wrong
const RANGE_SPEC = `^${EXPECTED_VERSION}`; // resolves-right-today but a range

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
}

describe("e2e: check-prisma-version bin in a scratch consumer", () => {
  let scratch: string;
  let packDir: string;
  let binPath: string;

  // Write a consumer package.json declaring the given prisma / @prisma/client
  // specs. The checker reads only this text (never node_modules), so we install
  // the library once and just rewrite the pins between scenarios.
  function writeConsumerPkg(clientSpec: string, cliSpec: string): void {
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify(
        {
          name: "scratch-consumer",
          version: "1.0.0",
          private: true,
          dependencies: { "@prisma/client": clientSpec },
          devDependencies: { prisma: cliSpec },
        },
        null,
        2,
      ),
    );
  }

  function runChecker(): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(binPath, [], {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env },
    });
    if (res.error) throw res.error;
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }

  beforeAll(() => {
    // 1. Build (prisma generate + tsc) so dist/ (incl. the compiled cli) exists.
    run(npm, ["run", "build"], REPO_ROOT);

    // 2. Real `npm pack` into a temp dir; capture the produced tarball.
    packDir = mkdtempSync(join(tmpdir(), "supagloo-dblib-cpv-pack-"));
    const packJson = run(
      npm,
      ["pack", "--pack-destination", packDir, "--json"],
      REPO_ROOT,
    );
    const filename = (JSON.parse(packJson) as Array<{ filename: string }>)[0]
      .filename;
    const tarball = join(packDir, filename);

    // 3. Scratch consumer. Install the tarball WITHOUT --save so npm does not
    //    rewrite the package.json pins we control. This links the package's
    //    `bin` into node_modules/.bin and pulls @prisma/client transitively.
    scratch = mkdtempSync(join(tmpdir(), "supagloo-dblib-cpv-consumer-"));
    writeConsumerPkg(EXPECTED_VERSION, EXPECTED_VERSION);
    run(
      npm,
      ["install", tarball, "--no-save", "--no-audit", "--no-fund"],
      scratch,
    );
    binPath = join(scratch, "node_modules", ".bin", "check-prisma-version");
  });

  afterAll(() => {
    for (const dir of [scratch, packDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("links the check-prisma-version bin on install", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  it("exits 0 when both packages are pinned to the exact matched version", () => {
    writeConsumerPkg(EXPECTED_VERSION, EXPECTED_VERSION);
    const { status, stdout } = runChecker();
    expect(status).toBe(0);
    expect(stdout).toContain("OK");
    expect(stdout).toContain(EXPECTED_VERSION);
  });

  it("exits nonzero when a package is pinned to a different exact version", () => {
    writeConsumerPkg(DRIFTED_VERSION, EXPECTED_VERSION);
    const { status, stderr } = runChecker();
    expect(status).not.toBe(0);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain(DRIFTED_VERSION);
    expect(stderr).toContain(EXPECTED_VERSION);
  });

  it("exits nonzero when a package is declared as a semver range", () => {
    writeConsumerPkg(RANGE_SPEC, EXPECTED_VERSION);
    const { status, stderr } = runChecker();
    expect(status).not.toBe(0);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toContain("FAILED");
    expect(stderr.toLowerCase()).toContain("range");
  });
});
