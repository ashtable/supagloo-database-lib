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
// Why a constant at all: Prisma's P2002 carries `meta.target`, and for an index Prisma
// did not create from the DSL that target is the INDEX NAME string — not a field list.
// The API's create/import paths match on it to turn the unique violation into the
// existing 409 `project_exists` instead of a raw 500. So the name is a cross-repo
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
    // THE assertion of this file. The constant is only useful if it equals what Postgres
    // will actually put in P2002's `meta.target`; a rename in the SQL alone (or in the
    // constant alone) turns the API's 409 mapping back into a 500, and no other test in
    // any repo would notice.
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
