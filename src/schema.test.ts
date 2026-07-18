import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  const schema = readFileSync(
    join(REPO_ROOT, "prisma", "schema.prisma"),
    "utf8",
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

  it("GalleryItem has exactly the specified columns (incl. scriptureBook, upvoteCount)", () => {
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
      ].sort(),
    );
    expect(fields).toContain("scriptureBook");
    expect(fields).toContain("upvoteCount");
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
  const schema = readFileSync(
    join(REPO_ROOT, "prisma", "schema.prisma"),
    "utf8",
  );

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
});

describe("Task #5 schema — Composition/Scene absence (generated client)", () => {
  it("generates no Composition or Scene model in the Prisma client", () => {
    const p = Prisma as unknown as Record<string, unknown>;
    expect(p.CompositionScalarFieldEnum).toBeUndefined();
    expect(p.SceneScalarFieldEnum).toBeUndefined();
  });
});
