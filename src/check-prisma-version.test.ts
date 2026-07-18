import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkPrismaVersion,
  formatReport,
  runCli,
  type CheckResult,
  type PackageJsonLike,
  type PinStatus,
} from "./check-prisma-version";
import { PRISMA_VERSION } from "./prisma-version";

// Directory of the static consumer fixtures (tests/fixtures/consumers/<name>).
const FIXTURES = fileURLToPath(
  new URL("../tests/fixtures/consumers/", import.meta.url),
);

function readFixture(name: string): PackageJsonLike {
  return JSON.parse(
    readFileSync(join(FIXTURES, name, "package.json"), "utf8"),
  ) as PackageJsonLike;
}

function statusOf(result: CheckResult, name: string): PinStatus | undefined {
  return result.findings.find((f) => f.name === name)?.status;
}

// The pure function is version-agnostic: the tests pass an explicit `expected`
// so they exercise logic (given expected X, spec Y => status Z) independent of
// whatever the live pin happens to be. `7.8.0` is the value baked into the
// fixtures; `7.9.0` in the fixtures represents drift from it.
const EXPECTED = "7.8.0";

describe("checkPrismaVersion — spec classification", () => {
  // For a single declared @prisma/client spec, what status does it get?
  function classify(spec: string): PinStatus | undefined {
    const pkg: PackageJsonLike = { dependencies: { "@prisma/client": spec } };
    return statusOf(checkPrismaVersion(pkg, EXPECTED), "@prisma/client");
  }

  const cases: Array<[string, PinStatus]> = [
    ["7.8.0", "ok"],
    ["7.9.0", "drift"],
    ["6.0.0", "drift"],
    ["8.0.0", "drift"],
    ["^7.8.0", "range"],
    ["~7.8.0", "range"],
    [">=7.8.0", "range"],
    [">=7.8.0 <8.0.0", "range"],
    ["*", "range"],
    ["x", "range"],
    ["7.8", "range"],
    ["7.x", "range"],
    ["latest", "range"],
    ["=7.8.0", "range"],
    ["7.8.0-rc.1", "range"],
    ["file:../database-lib", "range"],
  ];

  for (const [spec, expectedStatus] of cases) {
    it(`classifies "${spec}" as ${expectedStatus}`, () => {
      expect(classify(spec)).toBe(expectedStatus);
    });
  }
});

describe("checkPrismaVersion — fixture package.jsons", () => {
  it("passes when both prisma and @prisma/client are exact and matched", () => {
    const result = checkPrismaVersion(readFixture("exact-match"), EXPECTED);
    expect(result.ok).toBe(true);
    expect(statusOf(result, "@prisma/client")).toBe("ok");
    expect(statusOf(result, "prisma")).toBe("ok");
  });

  it("fails when specs are caret ranges", () => {
    const result = checkPrismaVersion(readFixture("caret-range"), EXPECTED);
    expect(result.ok).toBe(false);
    expect(statusOf(result, "@prisma/client")).toBe("range");
    expect(statusOf(result, "prisma")).toBe("range");
  });

  it("fails when specs are wildcards", () => {
    const result = checkPrismaVersion(readFixture("wildcard"), EXPECTED);
    expect(result.ok).toBe(false);
    expect(statusOf(result, "@prisma/client")).toBe("range");
    expect(statusOf(result, "prisma")).toBe("range");
  });

  it("fails when specs are exact but drifted to a different version", () => {
    const result = checkPrismaVersion(readFixture("drift-exact"), EXPECTED);
    expect(result.ok).toBe(false);
    expect(statusOf(result, "@prisma/client")).toBe("drift");
    expect(statusOf(result, "prisma")).toBe("drift");
  });

  it("fails on a single bad spec while the other is fine (mixed)", () => {
    const result = checkPrismaVersion(readFixture("mixed"), EXPECTED);
    expect(result.ok).toBe(false);
    expect(statusOf(result, "@prisma/client")).toBe("ok");
    expect(statusOf(result, "prisma")).toBe("range");
  });

  it("passes (tolerant) when neither package is declared", () => {
    const result = checkPrismaVersion(readFixture("missing-both"), EXPECTED);
    expect(result.ok).toBe(true);
    expect(statusOf(result, "@prisma/client")).toBe("missing");
    expect(statusOf(result, "prisma")).toBe("missing");
  });
});

describe("checkPrismaVersion — declaration section is recorded", () => {
  it("reports the section a spec was declared in", () => {
    const pkg: PackageJsonLike = {
      dependencies: { "@prisma/client": "^7.8.0" },
      devDependencies: { prisma: "7.8.0" },
    };
    const result = checkPrismaVersion(pkg, EXPECTED);
    const client = result.findings.find((f) => f.name === "@prisma/client");
    const cli = result.findings.find((f) => f.name === "prisma");
    expect(client?.declaredIn).toBe("dependencies");
    expect(client?.spec).toBe("^7.8.0");
    expect(cli?.declaredIn).toBe("devDependencies");
  });
});

describe("formatReport — actionable messages", () => {
  it("produces a success message naming the version and database-lib", () => {
    const text = formatReport(checkPrismaVersion(readFixture("exact-match"), EXPECTED));
    expect(text).toContain("OK");
    expect(text).toContain(EXPECTED);
    expect(text).toContain("@supagloo/database-lib");
  });

  it("flags a range with an actionable fix mentioning the exact version", () => {
    const text = formatReport(checkPrismaVersion(readFixture("caret-range"), EXPECTED));
    expect(text).toContain("FAILED");
    expect(text).toContain("@prisma/client");
    expect(text).toContain("^7.8.0"); // the offending declared spec is shown
    expect(text).toContain("range"); // reason: it is a range, not an exact pin
    expect(text).toContain(EXPECTED); // the required version to pin to
    expect(text).toContain("Fix:"); // actionable remediation line
  });

  it("distinguishes drift (different version) from a range", () => {
    const text = formatReport(checkPrismaVersion(readFixture("drift-exact"), EXPECTED));
    expect(text).toContain("FAILED");
    expect(text).toContain("7.9.0"); // the drifted spec
    expect(text).toContain("different version");
    expect(text).toContain(EXPECTED);
  });

  it("names only the offending package in the mixed case", () => {
    const text = formatReport(checkPrismaVersion(readFixture("mixed"), EXPECTED));
    expect(text).toContain("FAILED");
    // The failing line is about `prisma`, not `@prisma/client`.
    expect(text).toMatch(/(^|\W)prisma\b/);
  });
});

describe("runCli — reads a consumer package.json and returns an exit code", () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      log: (m: string) => out.push(m),
      error: (m: string) => err.push(m),
    };
  }

  it("returns 0 and logs success for an exact-matched consumer", () => {
    const io = capture();
    const code = runCli({
      cwd: join(FIXTURES, "exact-match"),
      expected: EXPECTED,
      log: io.log,
      error: io.error,
    });
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("OK");
    expect(io.err).toHaveLength(0);
  });

  it("returns 1 and reports failure for a range consumer", () => {
    const io = capture();
    const code = runCli({
      cwd: join(FIXTURES, "caret-range"),
      expected: EXPECTED,
      log: io.log,
      error: io.error,
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("FAILED");
  });

  it("returns 1 and reports failure for a drifted consumer", () => {
    const io = capture();
    const code = runCli({
      cwd: join(FIXTURES, "drift-exact"),
      expected: EXPECTED,
      log: io.log,
      error: io.error,
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("FAILED");
  });

  it("fails closed (returns 1) when package.json is missing", () => {
    const io = capture();
    const emptyDir = mkdtempSync(join(tmpdir(), "cpv-nopkg-"));
    try {
      const code = runCli({
        cwd: emptyDir,
        expected: EXPECTED,
        log: io.log,
        error: io.error,
      });
      expect(code).toBe(1);
      expect(io.err.join("\n").toLowerCase()).toContain("package.json");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("accepts a directory argument instead of cwd", () => {
    const io = capture();
    const code = runCli({
      cwd: FIXTURES,
      argv: ["exact-match"],
      expected: EXPECTED,
      log: io.log,
      error: io.error,
    });
    expect(code).toBe(0);
  });
});

describe("runCli — default expected version is wired to the live pin", () => {
  const created: string[] = [];
  afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  });

  function scratchConsumer(clientSpec: string, cliSpec: string): string {
    const dir = mkdtempSync(join(tmpdir(), "cpv-default-"));
    created.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "scratch",
          version: "1.0.0",
          private: true,
          dependencies: { "@prisma/client": clientSpec },
          devDependencies: { prisma: cliSpec },
        },
        null,
        2,
      ),
    );
    return dir;
  }

  it("passes with no explicit expected when pins equal PRISMA_VERSION", () => {
    const io = { log: () => {}, error: () => {} };
    const dir = scratchConsumer(PRISMA_VERSION, PRISMA_VERSION);
    expect(runCli({ cwd: dir, ...io })).toBe(0);
  });

  it("fails with no explicit expected when pins differ from PRISMA_VERSION", () => {
    const errs: string[] = [];
    const [maj, min, pat] = PRISMA_VERSION.split(".");
    const drifted = `${Number(maj) + 1}.${min}.${pat}`;
    const dir = scratchConsumer(drifted, drifted);
    const code = runCli({
      cwd: dir,
      log: () => {},
      error: (m) => errs.push(m),
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain(PRISMA_VERSION);
  });
});
