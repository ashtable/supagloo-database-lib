import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Prisma } from "./index";
// Namespace import (not named) so that, before the Task #5 enums exist in the
// generated client, `DbLib.<Enum>` reads as `undefined` at runtime instead of
// producing a hard ESM link error — keeps the RED phase clean and scoped.
import * as DbLib from "./index";

// Unit tests for the Task #4 Prisma schema (User, Session, GithubConnection,
// OpenRouterConnection, GlooConnection). DB-free: they introspect the generated
// client's `Prisma.<Model>ScalarFieldEnum` runtime objects (whose keys are the
// scalar columns), run `prisma validate`, parse the schema text for the declared
// unique/id constraints, and run a `tsc --noEmit` type-level check. Requires
// `prisma generate` first (pretest:unit hook). Real constraint *enforcement* is
// proven against Postgres in tests/e2e/schema.e2e.ts.

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function scalarFields(
  enumObj: Record<string, string> | undefined,
): string[] {
  expect(enumObj, "scalar-field enum should be generated for this model").toBeDefined();
  return Object.keys(enumObj as Record<string, string>).sort();
}

/**
 * Drop every Prisma comment (`//` and the `///` doc form) to end-of-line.
 *
 * Load-bearing, not cosmetic: EVERY assertion in this file is a regex over schema TEXT,
 * and a regex over raw text happily matches a COMMENTED-OUT declaration. Commenting out
 * the two `@@index` lines left the whole suite green while the datamodel had no sort
 * indexes at all — which is the entire point of the task-#39 migration. Prisma has no
 * block-comment syntax, so line-stripping is complete.
 */
function stripPrismaComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

describe("Task #4 schema — prisma validate", () => {
  it("validates the schema with the Prisma engine (exit 0)", () => {
    const res = spawnSync(npx, ["prisma", "validate"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
  }, 120_000);
});

describe("Task #4 schema — model columns (ScalarFieldEnum introspection)", () => {
  it("User has exactly the specified columns", () => {
    expect(scalarFields(Prisma.UserScalarFieldEnum)).toEqual(
      [
        "avatarInitials",
        "createdAt",
        "displayName",
        "email",
        "firstSignInAt",
        "id",
        "lastSeenAt",
        "onboardingCompletedAt",
        "updatedAt",
        "youversionUserId",
      ].sort(),
    );
  });

  it("Session has exactly the specified columns", () => {
    expect(scalarFields(Prisma.SessionScalarFieldEnum)).toEqual(
      ["createdAt", "expiresAt", "id", "lastUsedAt", "tokenHash", "userId"].sort(),
    );
  });

  it("GithubConnection has exactly the specified columns", () => {
    expect(scalarFields(Prisma.GithubConnectionScalarFieldEnum)).toEqual(
      [
        "connectedAt",
        "githubLogin",
        "installationId",
        "repositorySelection",
        "status",
        "userId",
      ].sort(),
    );
  });

  it("GithubConnection stores installationId and NO token column", () => {
    const fields = scalarFields(Prisma.GithubConnectionScalarFieldEnum);
    expect(fields).toContain("installationId");
    expect(fields.filter((f) => /token/i.test(f))).toEqual([]);
  });

  it("OpenRouterConnection has exactly the specified columns", () => {
    expect(scalarFields(Prisma.OpenRouterConnectionScalarFieldEnum)).toEqual(
      ["apiKeyCiphertext", "connectedAt", "keyLast4", "status", "userId"].sort(),
    );
  });

  it("GlooConnection has exactly the specified columns", () => {
    expect(scalarFields(Prisma.GlooConnectionScalarFieldEnum)).toEqual(
      [
        "clientId",
        "clientSecretCiphertext",
        "connectedAt",
        "lastVerifiedAt",
        "status",
        "userId",
      ].sort(),
    );
  });

  it("keeps three typed connection tables (no polymorphic `provider` discriminator)", () => {
    for (const enumObj of [
      Prisma.GithubConnectionScalarFieldEnum,
      Prisma.OpenRouterConnectionScalarFieldEnum,
      Prisma.GlooConnectionScalarFieldEnum,
    ]) {
      expect(scalarFields(enumObj)).not.toContain("provider");
    }
  });
});

describe("Task #4 schema — declared uniqueness (schema text introspection)", () => {
  // Comment-stripped for the same reason as the Task #5 block below: a regex over raw
  // schema text matches a commented-out declaration just as happily as a live one.
  const schema = stripPrismaComments(
    readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8"),
  );

  it("declares youversionUserId unique on User", () => {
    expect(schema).toMatch(/youversionUserId\s+String\s+@unique/);
  });

  it("declares tokenHash unique on Session", () => {
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
  });

  it("uses userId as the primary key on all three connection tables", () => {
    for (const model of [
      "GithubConnection",
      "OpenRouterConnection",
      "GlooConnection",
    ]) {
      const block = schema.match(
        new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`),
      )?.[0];
      expect(block, `model ${model} should exist`).toBeDefined();
      expect(block as string).toMatch(/userId\s+String\s+@id/);
    }
  });
});

describe("Task #4 schema — type-level compile check", () => {
  it("model types compile and GithubConnection exposes no token field", () => {
    const res = spawnSync(
      npx,
      [
        "tsc",
        "--noEmit",
        "--skipLibCheck",
        "--strict",
        "--esModuleInterop",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--target",
        "ES2022",
        join("tests", "typecheck", "models.type-assert.ts"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env } },
    );
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Task #5 — Project / ProjectVersion / ProjectJob / RenderJob / AiGeneration /
// GalleryItem / GalleryUpvote (design-delta §2.6–2.9). Same DB-free seams as
// Task #4: ScalarFieldEnum column introspection, generated enum consts, schema-
// text parsing, and the tsc type-assert fixture (extended). Real constraint
// enforcement is proven in tests/e2e/schema.e2e.ts. The whole-schema
// `prisma validate` test above already covers the new models + enums.
// ---------------------------------------------------------------------------

describe("Task #5 schema — model columns (ScalarFieldEnum introspection)", () => {
  it("Project has exactly the specified columns", () => {
    expect(scalarFields(Prisma.ProjectScalarFieldEnum)).toEqual(
      [
        "id",
        "slug",
        "ownerId",
        "name",
        "repoOwner",
        "repoName",
        "repoVisibility",
        "createdFrom",
        "currentBranch",
        "thumbnailAssetKey",
        "lastRenderJobId",
        "lastOpenedAt",
        "createdAt",
        "deletedAt",
      ].sort(),
    );
  });

  it("ProjectVersion has exactly the specified columns", () => {
    expect(scalarFields(Prisma.ProjectVersionScalarFieldEnum)).toEqual(
      [
        "id",
        "projectId",
        "semver",
        "branchName",
        "state",
        "commitMessage",
        "autoSummary",
        "changedFiles",
        "headCommitSha",
        "prNumber",
        "prUrl",
        "publishedAt",
      ].sort(),
    );
  });

  it("RenderJob has exactly the specified columns", () => {
    expect(scalarFields(Prisma.RenderJobScalarFieldEnum)).toEqual(
      [
        "id",
        "projectId",
        "versionId",
        "userId",
        "status",
        "framesDone",
        "framesTotal",
        "width",
        "height",
        "fps",
        "aspectRatio",
        "codec",
        "outputAssetKey",
        "thumbnailAssetKey",
        "runInBackground",
        "error",
        "createdAt",
        "startedAt",
        "completedAt",
      ].sort(),
    );
  });

  it("AiGeneration has exactly the specified columns (incl. providerJobId)", () => {
    const fields = scalarFields(Prisma.AiGenerationScalarFieldEnum);
    expect(fields).toEqual(
      [
        "id",
        "userId",
        "projectId",
        "sceneId",
        "kind",
        "provider",
        "model",
        "input",
        "status",
        "providerJobId",
        "resultJson",
        "resultAssetKey",
        "error",
        "tokenUsage",
        "createdAt",
        "completedAt",
      ].sort(),
    );
    expect(fields).toContain("providerJobId");
  });

  it("GalleryItem has exactly the specified columns (incl. scriptureBook, upvoteCount, makingOf)", () => {
    const fields = scalarFields(Prisma.GalleryItemScalarFieldEnum);
    expect(fields).toEqual(
      [
        "id",
        "renderJobId",
        "projectId",
        "ownerId",
        "title",
        "description",
        "scriptureReference",
        "translation",
        "scriptureBook",
        "durationSeconds",
        "videoAssetKey",
        "thumbnailAssetKey",
        "visibility",
        "publishedAt",
        "upvoteCount",
        "viewCount",
        // Turn 16a — the publish-time manifest snapshot the watch page renders.
        "makingOf",
      ].sort(),
    );
    expect(fields).toContain("scriptureBook");
    expect(fields).toContain("upvoteCount");
    expect(fields).toContain("makingOf");
  });

  it("GalleryUpvote has exactly the specified columns", () => {
    expect(scalarFields(Prisma.GalleryUpvoteScalarFieldEnum)).toEqual(
      ["id", "userId", "galleryItemId", "createdAt"].sort(),
    );
  });

  it("ProjectJob has exactly the specified columns", () => {
    expect(scalarFields(Prisma.ProjectJobScalarFieldEnum)).toEqual(
      [
        "id",
        "projectId",
        "userId",
        "versionId",
        "kind",
        "status",
        "stages",
        "error",
        "createdAt",
        "completedAt",
      ].sort(),
    );
  });
});

describe("Task #5 schema — enum value coverage (generated consts)", () => {
  function values(e: unknown): string[] {
    return Object.values((e ?? {}) as Record<string, string>).sort();
  }

  it("RepoVisibility = { private, public }", () => {
    expect(values(DbLib.RepoVisibility)).toEqual(["private", "public"].sort());
  });
  it("ProjectCreatedFrom = { votd, passage, blank, demo, import }", () => {
    expect(values(DbLib.ProjectCreatedFrom)).toEqual(
      ["votd", "passage", "blank", "demo", "import"].sort(),
    );
  });
  it("ProjectVersionState = { base, working, published, archived }", () => {
    expect(values(DbLib.ProjectVersionState)).toEqual(
      ["base", "working", "published", "archived"].sort(),
    );
  });
  it("RenderStatus covers all 8 pipeline states", () => {
    expect(values(DbLib.RenderStatus)).toEqual(
      [
        "queued",
        "bundling",
        "synthesizing",
        "encoding",
        "uploading",
        "completed",
        "failed",
        "canceled",
      ].sort(),
    );
  });
  it("GalleryVisibility = { public, unlisted }", () => {
    expect(values(DbLib.GalleryVisibility)).toEqual(
      ["public", "unlisted"].sort(),
    );
  });
  it("AiGenerationKind = { storyboard, script, image, narration, music, video }", () => {
    expect(values(DbLib.AiGenerationKind)).toEqual(
      ["storyboard", "script", "image", "narration", "music", "video"].sort(),
    );
  });
  it("AiProvider = { gloo, openrouter }", () => {
    expect(values(DbLib.AiProvider)).toEqual(["gloo", "openrouter"].sort());
  });
  it("ProjectJobKind = { scaffold, import_verify, commit, publish }", () => {
    expect(values(DbLib.ProjectJobKind)).toEqual(
      ["scaffold", "import_verify", "commit", "publish"].sort(),
    );
  });
  it("JobStatus (shared by ProjectJob + AiGeneration) = { queued, running, succeeded, failed, canceled }", () => {
    expect(values(DbLib.JobStatus)).toEqual(
      ["queued", "running", "succeeded", "failed", "canceled"].sort(),
    );
  });
});

describe("Task #5 schema — schema-text introspection", () => {
  const rawSchema = readFileSync(
    join(REPO_ROOT, "prisma", "schema.prisma"),
    "utf8",
  );
  // Every regex below runs over the COMMENT-STRIPPED text, so a commented-out
  // declaration can never satisfy an assertion. See stripPrismaComments.
  const schema = stripPrismaComments(rawSchema);

  it("strips comments before matching, so a commented-out declaration cannot pass", () => {
    // A guard on the guard: if stripPrismaComments ever became a no-op, every
    // schema-text assertion in this file would silently go back to matching comments.
    expect(rawSchema).toContain("// sort=popular (the DEFAULT sort)");
    expect(schema).not.toContain("sort=popular");
    expect(stripPrismaComments("  // @@index([a, b])")).toBe("  ");
    expect(stripPrismaComments("  @@index([a, b]) // keep")).toBe(
      "  @@index([a, b]) ",
    );
  });

  function enumMembers(name: string): string[] {
    const body = schema.match(
      new RegExp(`enum ${name}\\s*\\{([\\s\\S]*?)\\}`),
    )?.[1];
    if (body === undefined) return [];
    return body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"))
      .sort();
  }

  function modelBlock(name: string): string | undefined {
    return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0];
  }

  it("declares each enum with exactly the designed members", () => {
    expect(enumMembers("RepoVisibility")).toEqual(["private", "public"].sort());
    expect(enumMembers("ProjectCreatedFrom")).toEqual(
      ["votd", "passage", "blank", "demo", "import"].sort(),
    );
    expect(enumMembers("ProjectVersionState")).toEqual(
      ["base", "working", "published", "archived"].sort(),
    );
    expect(enumMembers("RenderStatus")).toEqual(
      [
        "queued",
        "bundling",
        "synthesizing",
        "encoding",
        "uploading",
        "completed",
        "failed",
        "canceled",
      ].sort(),
    );
    expect(enumMembers("GalleryVisibility")).toEqual(
      ["public", "unlisted"].sort(),
    );
    expect(enumMembers("AiGenerationKind")).toEqual(
      ["storyboard", "script", "image", "narration", "music", "video"].sort(),
    );
    expect(enumMembers("AiProvider")).toEqual(["gloo", "openrouter"].sort());
    expect(enumMembers("ProjectJobKind")).toEqual(
      ["scaffold", "import_verify", "commit", "publish"].sort(),
    );
    expect(enumMembers("JobStatus")).toEqual(
      ["queued", "running", "succeeded", "failed", "canceled"].sort(),
    );
  });

  it("uses ONE shared JobStatus enum for ProjectJob + AiGeneration (not two identical enums)", () => {
    // Ambiguity resolution #1 encoded as a test: a single shared JobStatus,
    // referenced by both status columns; the rejected duplicated-enum
    // alternative (ProjectJobStatus / AiGenerationStatus) must NOT exist.
    expect(schema.match(/enum JobStatus\b/g)?.length).toBe(1);
    expect(schema).not.toMatch(/enum ProjectJobStatus\b/);
    expect(schema).not.toMatch(/enum AiGenerationStatus\b/);
    expect(modelBlock("ProjectJob")).toMatch(/status\s+JobStatus/);
    expect(modelBlock("AiGeneration")).toMatch(/status\s+JobStatus/);
  });

  it("declares the four uniqueness constraints", () => {
    expect(modelBlock("Project")).toMatch(/@@unique\(\[ownerId, slug\]\)/);
    expect(modelBlock("ProjectVersion")).toMatch(
      /@@unique\(\[projectId, semver\]\)/,
    );
    expect(modelBlock("GalleryItem")).toMatch(/renderJobId\s+String\s+@unique/);
    expect(modelBlock("GalleryUpvote")).toMatch(
      /@@unique\(\[userId, galleryItemId\]\)/,
    );
  });

  it("declares a nullable deletedAt soft-delete column on Project", () => {
    expect(modelBlock("Project")).toMatch(/deletedAt\s+DateTime\?/);
  });

  it("declares NO Composition or Scene model (composition lives in the repo manifest)", () => {
    expect(schema).not.toMatch(/model\s+Composition\b/);
    expect(schema).not.toMatch(/model\s+Scene\b/);
  });

  // -------------------------------------------------------------------------
  // Task #39 — gallery sort indexes (plan D1). The gallery listing is the ONLY
  // endpoint in the system that is not scoped to one user, so it cannot ride an
  // existing ownerId/userId index. `sort=popular` is the DEFAULT order on a public,
  // unauthenticated, crawlable page; without a composite index it is a full scan
  // plus a sort on every anonymous page view. Plain ASCENDING composites are
  // correct: Postgres scans a btree backwards, so `(visibility, upvoteCount, id)`
  // serves `ORDER BY "upvoteCount" DESC, "id" DESC` AND the keyset predicate
  // `("upvoteCount", "id") < ($k, $i)`. The trending expression contains `now` and
  // is therefore deliberately NOT indexed (design-delta §2.7 defers a stored score).
  // -------------------------------------------------------------------------

  it("declares the two composite gallery sort indexes on GalleryItem (U-SI1)", () => {
    const block = modelBlock("GalleryItem");
    expect(block, "model GalleryItem should exist").toBeDefined();
    expect(block as string).toMatch(
      /@@index\(\[visibility, publishedAt, id\]\)/, // sort=newest
    );
    expect(block as string).toMatch(
      /@@index\(\[visibility, upvoteCount, id\]\)/, // sort=popular (the default)
    );
  });

  it("keeps the three pre-existing GalleryItem indexes (the sort indexes are ADDITIVE)", () => {
    const block = modelBlock("GalleryItem") as string;
    expect(block).toMatch(/@@index\(\[projectId\]\)/);
    expect(block).toMatch(/@@index\(\[ownerId\]\)/);
    expect(block).toMatch(/@@index\(\[scriptureBook\]\)/);
  });

  it("adds NO column to GalleryItem or GalleryUpvote (indexes only — U-SI2)", () => {
    // The column-set assertions above are the primary guard; this pins the COUNT so
    // an accidental column slipped in alongside the index migration fails loudly here
    // too, with a message that says what happened.
    //
    // The count moved 16 -> 17 on 2026-07-26 when Turn 16a added `makingOf`. Task #39's
    // own claim is unchanged and still true — IT adds indexes, not columns; the number
    // is simply the table's current width, and it is pinned so the next accidental
    // column still fails here.
    expect(
      scalarFields(Prisma.GalleryItemScalarFieldEnum).length,
      "GalleryItem is a 17-column table (16 from #39 + Turn 16a's makingOf); an index migration must not widen it",
    ).toBe(17);
    expect(
      scalarFields(Prisma.GalleryUpvoteScalarFieldEnum).length,
      "GalleryUpvote is a 4-column table; task #40 adds no column",
    ).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Turn 16a — GalleryItem.makingOf (the publish-time manifest snapshot)
  // -------------------------------------------------------------------------

  it("the GalleryItem model carries a NULLABLE makingOf Json column", () => {
    // NULLABLE is the load-bearing half. Every gallery item published before this
    // column existed has no snapshot, and the publish path writes the snapshot
    // BEST-EFFORT (a failed manifest read still returns 201). A NOT NULL column — or one
    // with a default — would either break the backfill or invent an empty snapshot that
    // the watch page would render as a real, empty "HOW IT WAS MADE" section.
    const block = modelBlock("GalleryItem");
    expect(block, "model GalleryItem should exist").toBeDefined();
    expect(block as string).toMatch(/\bmakingOf\s+Json\?/);
    // No default: `Json? @default(...)` would make "never captured" indistinguishable
    // from "captured and empty".
    expect(block as string).not.toMatch(/\bmakingOf\s+Json\?[^\n]*@default/);
  });

  it("does NOT index makingOf (nothing queries it — it is read by primary key only)", () => {
    // Read only via `GET /v1/gallery/:id`, which already has the pkey. A jsonb index
    // would cost every publish a write for no read.
    expect(modelBlock("GalleryItem") as string).not.toMatch(/@@index\(\[makingOf\]\)/);
  });

  // -------------------------------------------------------------------------
  // Task #42 — Session.expiresAt index (the scheduled cleanup workflow's purge)
  // -------------------------------------------------------------------------

  it("declares @@index([expiresAt]) on Session (U-SE1)", () => {
    // `cleanupOrphanedAssetsWorkflow` purges `Session WHERE "expiresAt" < now()` daily.
    // Session has no index on that column today, so the purge is a full sequential scan
    // of the busiest small table in the schema — every sign-in writes a row and every
    // authenticated request re-stamps one (sessions are SLIDING).
    const block = modelBlock("Session");
    expect(block, "model Session should exist").toBeDefined();
    expect(block as string).toMatch(/@@index\(\[expiresAt\]\)/);
  });

  it("keeps Session's userId index and adds no column (U-SE2)", () => {
    // Additive: `@@index([userId])` serves "all sessions for this user" (sign-out-all)
    // and `tokenHash @unique` serves the per-request lookup. Neither is replaced.
    const block = modelBlock("Session") as string;
    expect(block).toMatch(/@@index\(\[userId\]\)/);
    expect(block).toMatch(/tokenHash\s+String\s+@unique/);
    expect(
      scalarFields(Prisma.SessionScalarFieldEnum).length,
      "Session is a 6-column table; an index migration must not widen it",
    ).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Task #49 — the Project active-repo PARTIAL unique index
  // -------------------------------------------------------------------------

  it("does NOT declare a TOTAL @@unique on (ownerId, repoOwner, repoName) (U-PU1)", () => {
    // The Prisma DSL's `@@unique` has no `where`, so declaring it here would create a
    // TOTAL unique — and a total unique counts soft-deleted rows. A user who deletes a
    // project and then re-imports the same repo would be permanently blocked, which is
    // the exact opposite of the invariant task #49 is adding. The index is raw SQL in
    // the migration instead; this assertion keeps a well-meaning "the schema should
    // declare its own constraints" edit from silently breaking delete-then-recreate.
    const block = modelBlock("Project") as string;
    expect(block).not.toMatch(/@@unique\(\[ownerId, repoOwner, repoName\]\)/);
    expect(block).not.toMatch(/@@unique\(\[[^\]]*repoName[^\]]*\]\)/);
    // The pre-existing per-owner slug unique is untouched.
    expect(block).toMatch(/@@unique\(\[ownerId, slug\]\)/);
  });

  it("records the raw partial unique index in a Project doc comment (U-PU2)", () => {
    // The datamodel cannot express the index, so `prisma migrate diff` will now report
    // it as a permanent extra DB index (on top of the pre-existing out-of-Prisma
    // `noop_proof` line). Without this note the next reader "reconciles" the diff by
    // dropping the index — so the note is asserted, on the RAW (un-stripped) text.
    const projectBlockRaw = rawSchema.match(
      /model Project \{[\s\S]*?\n\}/,
    )?.[0] as string;
    expect(projectBlockRaw, "model Project should exist").toBeDefined();
    expect(projectBlockRaw).toContain(
      "Project_ownerId_repoOwner_repoName_active_key",
    );
    expect(projectBlockRaw).toMatch(/deletedAt.{0,40}IS NULL/s);
  });
});

// ---------------------------------------------------------------------------
// Tasks #42 + #49 — the ONE bundled index migration
// ---------------------------------------------------------------------------
// Bundled deliberately (brief §0.5/§10 R1): db-lib is a `file:` dependency nested in
// api and dbos and the one-shot Compose `migrate` service deploys from the api image,
// so every db-lib release is a five-step submodule + image-rebuild chain. Two index
// migrations would mean running that chain twice and invite a half-applied state.
//
// Same rule as the task #39 / Turn 16a blocks: schema.prisma generates the client, the
// MIGRATION is what the database gets, and only the migration ships. The directory is
// resolved by name suffix (not a hardcoded timestamp) and "exactly one" is asserted.
describe("Tasks #42/#49 migration — session_expiry_and_project_repo_indexes SQL", () => {
  const MIGRATION_SUFFIX = "_session_expiry_and_project_repo_indexes";

  function stripSqlComments(text: string): string {
    return text
      .split("\n")
      .map((line) => {
        const at = line.indexOf("--");
        return at === -1 ? line : line.slice(0, at);
      })
      .join("\n");
  }

  /** Directories matching the suffix. Read lazily and existence-guarded: a module-scope
   *  readFileSync on a not-yet-authored path would fail this whole FILE with an error
   *  instead of failing these tests with assertions. */
  function migrationDirs(): string[] {
    const root = join(REPO_ROOT, "prisma", "migrations");
    if (!existsSync(root)) return [];
    return readdirSync(root).filter((d) => d.endsWith(MIGRATION_SUFFIX));
  }

  function sql(): string {
    const dirs = migrationDirs();
    if (dirs.length !== 1) return "";
    const file = join(
      REPO_ROOT,
      "prisma",
      "migrations",
      dirs[0] as string,
      "migration.sql",
    );
    return existsSync(file) ? stripSqlComments(readFileSync(file, "utf8")) : "";
  }

  it("is exactly ONE migration directory (U-MIG1)", () => {
    expect(
      migrationDirs(),
      "rows 42 and 49 ship ONE bundled migration, not two",
    ).toHaveLength(1);
  });

  it("creates the Session expiresAt index (U-MIG2)", () => {
    expect(sql()).toMatch(
      /CREATE INDEX "Session_expiresAt_idx" ON "Session"\("expiresAt"\)/,
    );
  });

  it("creates the Project active-repo PARTIAL UNIQUE index (U-MIG3)", () => {
    // All four properties matter and each has a distinct failure mode:
    //   UNIQUE      — an INDEX would make the migration a no-op for the race.
    //   column order— (ownerId, repoOwner, repoName) also serves the per-owner lookup.
    //   the name    — it is what P2002.meta.target carries into the API's 409 mapping.
    //   the WHERE   — without it, a soft-deleted project blocks re-creating that repo.
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX "Project_ownerId_repoOwner_repoName_active_key"\s+ON "Project"\("ownerId", "repoOwner", "repoName"\)\s+WHERE "deletedAt" IS NULL/,
    );
  });

  it("adds NOTHING else — two CREATEs, no ALTER, no DROP, and no data fixup (U-MIG4)", () => {
    const text = sql();
    expect(text.match(/CREATE (UNIQUE )?INDEX/g) ?? []).toHaveLength(2);
    for (const forbidden of [
      /ALTER TABLE/i,
      /DROP /i,
      /CREATE TABLE/i,
      // D49.3: pre-existing duplicates are resolved by hand BEFORE deploying (the
      // preflight found none). A dedupe DELETE hidden inside an "indexes only"
      // migration would silently destroy production rows.
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
    ]) {
      expect(text, `${String(forbidden)} must not appear`).not.toMatch(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Turn 16a — the MIGRATION, not just the datamodel
// ---------------------------------------------------------------------------
// Same rule as task #39's block above: `schema.prisma` generates the client, the
// migration is what the DATABASE gets, and only the migration ships. SQL comments are
// stripped so a commented-out statement cannot satisfy a regex.
describe("Turn 16a migration — gallery_making_of SQL", () => {
  const MIGRATION_DIR = "20260727002708_gallery_making_of";

  function stripSqlComments(text: string): string {
    return text
      .split("\n")
      .map((line) => {
        const at = line.indexOf("--");
        return at === -1 ? line : line.slice(0, at);
      })
      .join("\n");
  }

  const sql = stripSqlComments(
    readFileSync(
      join(REPO_ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql"),
      "utf8",
    ),
  );

  it("adds makingOf as a NULLABLE JSONB column", () => {
    expect(sql).toMatch(
      /ALTER TABLE "GalleryItem" ADD COLUMN\s+"makingOf" JSONB/,
    );
    // No NOT NULL and no DEFAULT: an ALTER that added either would rewrite the table
    // and would give every pre-existing row a snapshot it never had.
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/DEFAULT/i);
  });

  it("adds NOTHING else — one ALTER, no DROP, no data change, no index", () => {
    expect(sql.match(/ALTER TABLE/gi) ?? []).toHaveLength(1);
    for (const forbidden of [
      /DROP /i,
      /CREATE TABLE/i,
      /CREATE INDEX/i,
      /UPDATE /i,
      /DELETE /i,
    ]) {
      expect(sql, `${String(forbidden)} must not appear`).not.toMatch(forbidden);
    }
  });
});

describe("Task #5 schema — Composition/Scene absence (generated client)", () => {
  it("generates no Composition or Scene model in the Prisma client", () => {
    const p = Prisma as unknown as Record<string, unknown>;
    expect(p.CompositionScalarFieldEnum).toBeUndefined();
    expect(p.SceneScalarFieldEnum).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task #39 — the MIGRATION, not just the datamodel
// ---------------------------------------------------------------------------

// `schema.prisma` is what the client is generated from; the migration is what the
// DATABASE gets. They can disagree, and only the migration ships to production, so the
// committed SQL is asserted separately here. Truncating this file to a bare
// `-- CreateIndex` comment left the whole suite green, which is why SQL comments are
// stripped before matching. The indexes actually EXISTING in Postgres, with the right
// column ORDER, is proven in tests/e2e/schema.e2e.ts against a real migrate deploy.
describe("Task #39 migration — gallery_sort_indexes SQL", () => {
  const MIGRATION_DIR = "20260726055955_gallery_sort_indexes";

  /** Strip `--` line comments so a commented-out statement cannot satisfy a regex. */
  function stripSqlComments(text: string): string {
    return text
      .split("\n")
      .map((line) => {
        const at = line.indexOf("--");
        return at === -1 ? line : line.slice(0, at);
      })
      .join("\n");
  }

  const sql = stripSqlComments(
    readFileSync(
      join(REPO_ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql"),
      "utf8",
    ),
  );

  it("creates both composite indexes with the designed column order", () => {
    expect(sql).toMatch(
      /CREATE INDEX "GalleryItem_visibility_publishedAt_id_idx" ON "GalleryItem"\("visibility", "publishedAt", "id"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX "GalleryItem_visibility_upvoteCount_id_idx" ON "GalleryItem"\("visibility", "upvoteCount", "id"\)/,
    );
    expect(sql.match(/CREATE INDEX/g)).toHaveLength(2);
  });

  it("adds NOTHING else — no ALTER TABLE, no DROP, no data change", () => {
    // The migration is additive and reversible by design (drop two indexes). A column
    // change smuggled in here would ship to production behind an "indexes only" title.
    for (const forbidden of [/ALTER TABLE/i, /DROP /i, /CREATE TABLE/i, /UPDATE /i]) {
      expect(sql, `${String(forbidden)} must not appear`).not.toMatch(forbidden);
    }
  });
});
