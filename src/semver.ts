/**
 * Minimal semver parse + compare helpers (design-delta §2.6).
 *
 * `ProjectVersion.semver` is a free-form, NON-zero-padded string (`"0.0.0"`,
 * `"0.2.3"`, `"0.10.0"` for imports), so ordering it MUST be numeric — a lexical
 * string sort is wrong (`"0.10.0" < "0.2.0"` lexically, but 0.10.0 is the newer
 * version). There is no `semver` npm dependency in the workspace and a full semver
 * implementation is unwarranted for a three-integer compare, so this is a tiny
 * hand-rolled helper.
 *
 * Shared in `database-lib` (not the API) because both the API's version listing
 * (#14) and the DBOS publish workflow's next-semver bump (#22) need the same
 * parse/compare — one home keeps the ordering and the bump consistent.
 *
 * We deliberately ignore pre-release / build metadata: v1 only ever produces plain
 * `X.Y.Z` (`v0.0.1` branches, imported `0.2.3`). Anything that is not `X.Y.Z`
 * parses to `null` and, in {@link compareSemver}, sorts BELOW any parseable version.
 */

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

// Optional leading `v` (branch-name style) then three non-negative integer groups.
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Parse `X.Y.Z` (optionally `vX.Y.Z`) into numeric parts, or `null` if it is not
 *  that shape. */
export function parseSemver(value: string): ParsedSemver | null {
  const m = SEMVER_RE.exec(value);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * Ascending comparator for two semver strings (usable directly as an
 * `Array.prototype.sort` comparator). Returns a negative number if `a < b`, a
 * positive number if `a > b`, and `0` if equal. An unparseable version sorts BELOW
 * any parseable one; two unparseables compare equal (the caller applies its own
 * stable tiebreak, e.g. row id).
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * The next working version's semver for the publish workflow (design-delta §7 workflow 4):
 * the PATCH bump of the HIGHEST existing version. Derived numerically via
 * {@link compareSemver} (so `0.10.0 > 0.2.0` and `0.2.3 → 0.2.4`), NOT a hardcoded
 * `0.0.(n+1)` — imported projects carry free-form semver that a naive counter would break.
 *
 * Unparseable entries are ignored (they sort below any real version). Throws when the set
 * has no parseable version at all — every project carries at least `0.0.0`, so an empty /
 * all-unparseable set is an invariant violation, not a case to paper over with a default.
 */
export function nextPatchVersion(existing: readonly string[]): string {
  const parseable = existing.filter((v) => parseSemver(v) !== null);
  if (parseable.length === 0) {
    throw new Error(
      "nextPatchVersion: no parseable semver in the existing version set",
    );
  }
  const highest = parseable.reduce((a, b) => (compareSemver(a, b) >= 0 ? a : b));
  const p = parseSemver(highest)!;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}
