import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRISMA_VERSION } from "./prisma-version";

// The pinned Prisma version is a self-consistency invariant across four places.
// The generated Prisma client shipped in dist/ is version-coupled to the
// @prisma/client runtime every consumer installs, so a drift between any of
// these silently breaks consumers at runtime rather than at install time.
// This is the artifact that the consumer-side check-prisma-version script
// (later task #2) reads; here we only prove the source is self-consistent.

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  supagloo?: { prismaVersion?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

describe("PRISMA_VERSION", () => {
  it("is exported as a non-empty exact semver string", () => {
    expect(typeof PRISMA_VERSION).toBe("string");
    expect(PRISMA_VERSION).toMatch(EXACT_SEMVER);
  });

  it("equals package.json supagloo.prismaVersion", () => {
    expect(pkg.supagloo?.prismaVersion).toBe(PRISMA_VERSION);
  });

  it("equals the exact @prisma/client dependency pin", () => {
    const pin = pkg.dependencies?.["@prisma/client"];
    expect(pin).toBe(PRISMA_VERSION);
    expect(pin).toMatch(EXACT_SEMVER);
  });

  it("equals the exact prisma (CLI) devDependency pin", () => {
    const pin = pkg.devDependencies?.["prisma"];
    expect(pin).toBe(PRISMA_VERSION);
    expect(pin).toMatch(EXACT_SEMVER);
  });
});
