import { describe, expect, it } from "vitest";
import { parseSemver, compareSemver, nextPatchVersion } from "./semver";

// Unit tests for the Task #14 semver ordering helpers (design-delta §2.6). Pure,
// DB-free. `ProjectVersion.semver` is free-form and NOT zero-padded, so ordering
// MUST be numeric (0.10.0 is newer than 0.2.0), never lexical. Shared in db-lib so
// the #22 publish workflow (next-semver bump) reuses the same parse/compare.

describe("parseSemver", () => {
  it("parses plain X.Y.Z into numeric parts", () => {
    expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseSemver("0.2.3")).toEqual({ major: 0, minor: 2, patch: 3 });
    // The whole point: 10 is a number, not the string "10".
    expect(parseSemver("0.10.0")).toEqual({ major: 0, minor: 10, patch: 0 });
    expect(parseSemver("12.34.56")).toEqual({ major: 12, minor: 34, patch: 56 });
  });

  it("tolerates an optional leading v (branch-name style)", () => {
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("returns null for anything that is not X.Y.Z", () => {
    for (const bad of ["", "1.2", "1.2.3.4", "a.b.c", "1.2.x", "1..3", "x"]) {
      expect(parseSemver(bad), bad).toBeNull();
    }
  });
});

describe("compareSemver", () => {
  it("orders numerically, not lexically (the headline case)", () => {
    // Lexically "0.10.0" < "0.2.0"; numerically 0.10.0 is the NEWER version.
    expect(compareSemver("0.10.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0", "0.10.0")).toBeLessThan(0);
  });

  it("compares major, then minor, then patch", () => {
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0); // major dominates
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0); // minor dominates
    expect(compareSemver("0.0.2", "0.0.1")).toBeGreaterThan(0); // patch
    expect(compareSemver("0.0.1", "0.0.2")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("sorts an unparseable semver below any parseable one; two unparseables tie", () => {
    expect(compareSemver("nope", "0.0.1")).toBeLessThan(0);
    expect(compareSemver("0.0.1", "nope")).toBeGreaterThan(0);
    expect(compareSemver("bad", "worse")).toBe(0);
  });

  it("is usable as an ascending Array.sort comparator", () => {
    const sorted = ["0.2.0", "0.10.0", "0.0.1"].sort(compareSemver);
    expect(sorted).toEqual(["0.0.1", "0.2.0", "0.10.0"]);
  });
});

// Task #22: the publish workflow's next-version bump. The next working branch is the
// PATCH bump of the HIGHEST existing version — derived numerically (0.10.0 > 0.2.0), NOT
// a hardcoded v0.0.(n+1), because imported projects carry free-form semver (design-delta
// §7 workflow 4).
describe("nextPatchVersion", () => {
  it("bumps the patch of the highest existing version (the fresh-project 0.0.1 → 0.0.2 case)", () => {
    expect(nextPatchVersion(["0.0.0", "0.0.1"])).toBe("0.0.2");
  });

  it("bumps the highest for an imported project's free-form semver (0.2.3 → 0.2.4)", () => {
    // Order-independent: the highest of the set is bumped, whatever order it arrives in.
    expect(nextPatchVersion(["0.2.1", "0.2.3", "0.2.2"])).toBe("0.2.4");
  });

  it("picks the highest NUMERICALLY, not lexically (0.10.0 > 0.9.0)", () => {
    expect(nextPatchVersion(["0.9.0", "0.10.0"])).toBe("0.10.1");
    expect(nextPatchVersion(["0.0.9", "0.0.10"])).toBe("0.0.11");
  });

  it("ignores unparseable entries when a parseable one exists", () => {
    expect(nextPatchVersion(["not-semver", "0.1.4", "also-bad"])).toBe("0.1.5");
  });

  it("throws when the set is empty or has no parseable version (invariant violation)", () => {
    expect(() => nextPatchVersion([])).toThrow();
    expect(() => nextPatchVersion(["nope", "bad"])).toThrow();
  });
});
