import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new Projects/Versions wire
// DTOs and the shared semver helpers are re-exported from the package entry, and
// that `ProjectDto`/`ProjectVersionDto` do NOT collide with the re-exported Prisma
// `Project`/`ProjectVersion` model types.
import * as DbLib from "./index";
import * as S from "./schemas";

// Unit tests for the Task #14 Projects/Versions WIRE DTOs (design-delta §2.6/§8).
// DB-free — pure Zod accept/reject + barrel-export checks.

const VALID_PROJECT = {
  id: "cprj1",
  slug: "psalm-121",
  name: "Psalm 121",
  repoOwner: "ashtable",
  repoName: "psalm-121",
  repoVisibility: "private",
  createdFrom: "blank",
  currentBranch: "v0.0.1",
  thumbnailAssetKey: null,
  lastRenderJobId: null,
  lastOpenedAt: "2026-07-19T00:00:00.000Z",
  createdAt: "2026-07-19T00:00:00.000Z",
};

const VALID_VERSION = {
  id: "cver1",
  projectId: "cprj1",
  semver: "0.0.1",
  branchName: "v0.0.1",
  state: "working",
  commitMessage: null,
  autoSummary: null,
  changedFiles: [],
  headCommitSha: null,
  prNumber: null,
  prUrl: null,
  publishedAt: null,
};

describe("Task #14 wire DTOs — ProjectDto", () => {
  it("accepts a full valid project (with nullable asset keys null)", () => {
    expect(S.ProjectDtoSchema.safeParse(VALID_PROJECT).success).toBe(true);
  });

  it("rejects an unknown repoVisibility enum value", () => {
    expect(
      S.ProjectDtoSchema.safeParse({
        ...VALID_PROJECT,
        repoVisibility: "secret",
      }).success,
    ).toBe(false);
  });

  it("rejects a project missing name", () => {
    const { name, ...noName } = VALID_PROJECT;
    void name;
    expect(S.ProjectDtoSchema.safeParse(noName).success).toBe(false);
  });
});

describe("Task #14 wire DTOs — ProjectVersionDto", () => {
  it("accepts a full valid version (nullable fields null, changedFiles array)", () => {
    expect(S.ProjectVersionDtoSchema.safeParse(VALID_VERSION).success).toBe(true);
  });

  it("accepts a published version with populated nullable fields", () => {
    expect(
      S.ProjectVersionDtoSchema.safeParse({
        ...VALID_VERSION,
        state: "published",
        commitMessage: "ship it",
        changedFiles: ["M src/scenes/Shelter.tsx"],
        headCommitSha: "abc123",
        prNumber: 7,
        prUrl: "https://github.com/x/y/pull/7",
        publishedAt: "2026-07-19T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown state enum value", () => {
    expect(
      S.ProjectVersionDtoSchema.safeParse({ ...VALID_VERSION, state: "frozen" })
        .success,
    ).toBe(false);
  });
});

describe("Task #14 wire DTOs — request/response wrappers", () => {
  it("ProjectRenameRequestSchema requires a non-empty name", () => {
    expect(S.ProjectRenameRequestSchema.safeParse({ name: "x" }).success).toBe(
      true,
    );
    expect(S.ProjectRenameRequestSchema.safeParse({}).success).toBe(false);
    expect(S.ProjectRenameRequestSchema.safeParse({ name: "" }).success).toBe(
      false,
    );
  });

  it("ProjectIdParamSchema requires a non-empty id", () => {
    expect(S.ProjectIdParamSchema.safeParse({ id: "cprj1" }).success).toBe(true);
    expect(S.ProjectIdParamSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("list/detail/delete response schemas accept their canonical shapes", () => {
    expect(
      S.ProjectListResponseSchema.safeParse({ projects: [VALID_PROJECT] }).success,
    ).toBe(true);
    expect(
      S.ProjectResponseSchema.safeParse({ project: VALID_PROJECT }).success,
    ).toBe(true);
    expect(
      S.ProjectVersionListResponseSchema.safeParse({ versions: [VALID_VERSION] })
        .success,
    ).toBe(true);
    expect(S.ProjectDeleteResponseSchema.safeParse({ ok: true }).success).toBe(
      true,
    );
    expect(S.ProjectDeleteResponseSchema.safeParse({ ok: false }).success).toBe(
      false,
    );
  });
});

describe("Task #14 barrel exports", () => {
  it("re-exports the Projects/Versions wire DTOs as Zod schemas", () => {
    for (const name of [
      "ProjectDtoSchema",
      "ProjectVersionDtoSchema",
      "ProjectListResponseSchema",
      "ProjectResponseSchema",
      "ProjectRenameRequestSchema",
      "ProjectDeleteResponseSchema",
      "ProjectVersionListResponseSchema",
      "ProjectIdParamSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[
        name
      ];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });

  it("re-exports the semver helpers as functions", () => {
    expect(typeof DbLib.parseSemver).toBe("function");
    expect(typeof DbLib.compareSemver).toBe("function");
  });
});
