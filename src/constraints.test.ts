import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Barrel-only, namespace import: `DbLib.X` reads as `undefined` before the constant
// exists, so the RED phase is a clean assertion failure rather than an ESM link error.
// It also proves the constant is reachable from the package entry point, which is the
// only way api/dbos can see it.
import * as DbLib from "./index";

// Task #49 — the raw-SQL PARTIAL UNIQUE index name, promoted to a shared constant.
//
// Why a constant at all: an index Prisma did not create from the DSL is identifiable only
// by its raw NAME, and `meta.target` does not exist on Prisma 7.8.0 + @prisma/adapter-pg
// (the measurement is recorded below), so the API's create/import paths recognize the
// violation with `isUniqueViolationOn(err, PROJECT_ACTIVE_REPO_UNIQUE_INDEX)` to turn it
// into the existing 409 `project_exists` instead of a raw 500. So the name is a cross-repo
// contract between this migration and `api/src/jobs/project-jobs-service.ts`; renaming
// the index without renaming the constant would silently reopen the 500.

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SUFFIX = "_session_expiry_and_project_repo_indexes";

/** The one migration directory for this task, or "" if it has not been authored yet. */
function migrationDir(): string {
  const root = join(REPO_ROOT, "prisma", "migrations");
  if (!existsSync(root)) return "";
  const hits = readdirSync(root).filter((d) => d.endsWith(MIGRATION_SUFFIX));
  return hits.length === 1 ? join(root, hits[0] as string) : "";
}

/** The migration's SQL, or "" when absent — read lazily so a missing file fails as an
 *  assertion inside one test, never as a module-load error across the whole file. */
function migrationSql(): string {
  const dir = migrationDir();
  if (dir === "") return "";
  const file = join(dir, "migration.sql");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("Task #49 constraints — Project active-repo partial unique index name", () => {
  it("pins the index name (U49-1)", () => {
    expect(DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX).toBe(
      "Project_ownerId_repoOwner_repoName_active_key",
    );
  });

  it("uses Prisma's `_key` suffix, which marks a UNIQUE (not an `_idx` plain index)", () => {
    // Cosmetic-looking, load-bearing in practice: every other unique in this schema is
    // `<Model>_<cols>_key` and every plain index is `<Model>_<cols>_idx`. A unique named
    // `_idx` reads as non-enforcing to anyone scanning `\d "Project"`.
    const name = DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX as unknown as string;
    expect(name.endsWith("_key")).toBe(true);
    expect(name.endsWith("_idx")).toBe(false);
    // `_active_` is the human marker for the `WHERE "deletedAt" IS NULL` predicate — the
    // one property the name cannot otherwise convey.
    expect(name).toContain("_active_");
  });

  it("is byte-identical to the name in the committed migration SQL (U49-2)", () => {
    // THE assertion of this file. The constant is only useful if it equals the name
    // Postgres puts in the unique-violation message that `uniqueViolationIndexName`
    // parses (P2002 carries no `meta.target` on this stack — see the measurement below);
    // a rename in the SQL alone (or in the constant alone) turns the API's 409 mapping
    // back into a 500, and no other test in any repo would notice.
    const sql = migrationSql();
    expect(
      sql,
      `migration directory *${MIGRATION_SUFFIX} not found (or not unique)`,
    ).not.toBe("");
    expect(sql).toContain(`"${DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX}"`);
  });
});

// ---------------------------------------------------------------------------
// The P2002 → index-name reader
// ---------------------------------------------------------------------------
// MEASURED against the real Compose Postgres on Prisma 7.8.0 + @prisma/adapter-pg
// (this repo's only client factory), by provoking the violation and dumping the error:
//
//   err.code = "P2002"
//   err.meta = {
//     modelName: "Project",
//     driverAdapterError: { name: "DriverAdapterError", cause: {
//       originalCode: "23505",
//       originalMessage: 'duplicate key value violates unique constraint
//                         "Project_ownerId_repoOwner_repoName_active_key"',
//       kind: "UniqueConstraintViolation",
//       constraint: { fields: ['"ownerId"', '"repoOwner"', '"repoName"'] } } } }
//
// There is NO `meta.target` — not for the raw index and not for the DSL-generated
// `@@unique([ownerId, slug])` either. Consumers reaching for `err.meta.target` (the
// pre-driver-adapter shape) read `undefined` and fall through to a 500, silently, with
// no test anywhere going red. That is exactly the failure this reader exists to prevent,
// which is why it lives HERE — in the package that owns the client factory and the
// migration — instead of being re-derived in api and dbos.
//
// Fixtures below are duck-typed literals, never `new PrismaClientKnownRequestError(...)`:
// the repo's standing rule (auth-service.ts / gallery-service.ts) is that `instanceof`
// on Prisma error classes is unreliable across the nested `file:` dependency layout.
// The e2e proves the fixtures match a REAL error.

function p2002(originalMessage: string): unknown {
  return {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: {
      modelName: "Project",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage,
          kind: "UniqueConstraintViolation",
        },
      },
    },
  };
}

const REAL_MESSAGE =
  'duplicate key value violates unique constraint "Project_ownerId_repoOwner_repoName_active_key"';

describe("Task #49 constraints — uniqueViolationIndexName", () => {
  it("reads the index name out of the driver-adapter cause (the measured shape)", () => {
    expect(DbLib.uniqueViolationIndexName(p2002(REAL_MESSAGE))).toBe(
      "Project_ownerId_repoOwner_repoName_active_key",
    );
  });

  it("still reads a legacy string `meta.target` (older engines put the name there)", () => {
    expect(
      DbLib.uniqueViolationIndexName({
        code: "P2002",
        meta: { target: "Project_ownerId_repoOwner_repoName_active_key" },
      }),
    ).toBe("Project_ownerId_repoOwner_repoName_active_key");
  });

  it("returns null for a FIELD-LIST target — a field list is not an index name", () => {
    // The DSL-generated uniques report field lists. Treating one as an index name would
    // make `isUniqueViolationOn` match on a coincidence.
    expect(
      DbLib.uniqueViolationIndexName({
        code: "P2002",
        meta: { target: ["ownerId", "slug"] },
      }),
    ).toBeNull();
  });

  it("returns null for anything that is not a P2002", () => {
    expect(DbLib.uniqueViolationIndexName(new Error("boom"))).toBeNull();
    expect(DbLib.uniqueViolationIndexName(null)).toBeNull();
    expect(DbLib.uniqueViolationIndexName(undefined)).toBeNull();
    expect(DbLib.uniqueViolationIndexName("P2002")).toBeNull();
    // A different Prisma error code with an otherwise identical shape.
    expect(
      DbLib.uniqueViolationIndexName({
        ...(p2002(REAL_MESSAGE) as Record<string, unknown>),
        code: "P2003",
      }),
    ).toBeNull();
  });

  it("returns null when the message names no constraint", () => {
    expect(DbLib.uniqueViolationIndexName(p2002("something went wrong"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// U-CON-DOC — the module's prose must not re-arm the refuted `meta.target` mapper
// ---------------------------------------------------------------------------
// The measurement above and the e2e's `expect(err.meta?.target).toBeUndefined()` are only
// half the defence. A consuming engineer reads the file header and the EXPORTED
// CONSTANT's docstring first, and those used to say "catch `P2002`, compare `meta.target`
// against this constant" — a step-by-step instruction to build the mapper that provably
// reads `undefined` on Prisma 7.8.0 + @prisma/adapter-pg, i.e. the exact trap this module
// exists to close. Prose that instructs is code with a slow compiler, so it is pinned
// here as text: nothing else in any repo would notice it drifting back.

const CONSTRAINTS_SRC = readFileSync(
  join(REPO_ROOT, "src", "constraints.ts"),
  "utf8",
);

/** Any mention of the field — `meta.target`, `meta?.target`, `err.meta.target`. */
const TARGET_MENTION = /meta\??\.target/i;
/** Wording that tells the reader the field is not there on the pinned stack. */
const TARGET_NEGATION =
  /(do(?:es)? not exist|do(?:es)? not populate|no `meta\.target`|undefined|absent)/i;
/** The instruction that must not survive anywhere in the file. */
const COMPARE_INSTRUCTION = /compar\w*[^\n.]{0,40}meta\??\.target/i;

/** The `/** ... *\/` block immediately preceding `marker`, or "" if there is none. */
function docblockBefore(marker: string): string {
  const at = CONSTRAINTS_SRC.indexOf(marker);
  if (at === -1) return "";
  const before = CONSTRAINTS_SRC.slice(0, at);
  const start = before.lastIndexOf("/**");
  return start === -1 ? "" : before.slice(start);
}

describe("Task #49 constraints — the file's own documentation (U-CON-DOC)", () => {
  it("nowhere instructs a caller to compare `meta.target` (U-CON-DOC-1)", () => {
    expect(
      CONSTRAINTS_SRC,
      "constraints.ts still tells the reader to build the mapper that reads `undefined`",
    ).not.toMatch(COMPARE_INSTRUCTION);
  });

  it("points the exported constant's docstring at `isUniqueViolationOn` (U-CON-DOC-2)", () => {
    const doc = docblockBefore("export const PROJECT_ACTIVE_REPO_UNIQUE_INDEX");
    expect(doc, "the exported constant has no docstring").not.toBe("");
    // The constant is useless without a supported way to recognize the violation, and
    // this docblock is the one a consuming engineer reads first.
    expect(doc).toContain("isUniqueViolationOn");
    expect(doc).not.toMatch(COMPARE_INSTRUCTION);
  });

  it("keeps every surviving `meta.target` mention next to its negation (U-CON-DOC-3)", () => {
    // The field is still NAMED in this file — the reader honours the legacy shapes, and
    // the refutation cannot be stated without naming what is being refuted. The rule is
    // therefore proximity, not absence: no mention may sit more than two lines away from
    // the statement that it does not exist on Prisma 7.8.0 + @prisma/adapter-pg.
    const lines = CONSTRAINTS_SRC.split("\n");
    // Strip the comment markers and join with a space, so a negation that the prose
    // happens to WRAP ("…does not\n * exist…") still counts. The rule is about what a
    // reader takes away, not about where the 90th column fell.
    const window = (i: number): string =>
      lines
        .slice(Math.max(0, i - 2), i + 3)
        .map((l) => l.replace(/^\s*(?:\*|\/\/)\s?/, ""))
        .join(" ");
    const orphans = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => TARGET_MENTION.test(line))
      .filter(({ i }) => !TARGET_NEGATION.test(window(i)))
      .map(({ line, i }) => `${i + 1}: ${line.trim()}`);
    expect(
      orphans,
      "each of these `meta.target` mentions reads as fact with no refutation in sight",
    ).toEqual([]);
  });
});

describe("Task #49 constraints — isUniqueViolationOn", () => {
  it("is true only for the named index", () => {
    const err = p2002(REAL_MESSAGE);
    expect(
      DbLib.isUniqueViolationOn(err, DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX),
    ).toBe(true);
    // The per-owner slug unique fires from the SAME table on the SAME create call. A
    // caller that swallowed it as "project_exists for this repo" would answer 409 to a
    // request whose real problem is a duplicate slug.
    expect(
      DbLib.isUniqueViolationOn(
        p2002(
          'duplicate key value violates unique constraint "Project_ownerId_slug_key"',
        ),
        DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX,
      ),
    ).toBe(false);
  });

  it("is false for non-P2002 errors, so a catch can rethrow them unchanged", () => {
    expect(
      DbLib.isUniqueViolationOn(
        new Error("connection reset"),
        DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX,
      ),
    ).toBe(false);
  });
});
