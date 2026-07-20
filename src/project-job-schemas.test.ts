import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";
import { buildBlankManifest } from "./manifest-defaults";

// Task #18 wire DTOs (design-delta §5.1/§6b/§8): the create-project request/response
// and the job-polling response, plus the ScaffoldProjectPayload enqueue contract.
// DB-free — pure Zod accept/reject + barrel-export checks.

const VALID_CREATE = {
  name: "Psalm 121",
  repoOwner: "ashtable",
  repoName: "psalm-121",
  visibility: "private",
  createdFrom: "blank",
};

const VALID_JOB = {
  id: "job-1",
  projectId: "cprj1",
  kind: "scaffold",
  status: "running",
  stages: [
    { key: "mintInstallationToken", label: "Authenticating with GitHub", state: "done" },
    { key: "cloneToWorkspace", label: "Cloning repository", state: "running" },
  ],
  error: null,
  createdAt: "2026-07-19T00:00:00.000Z",
  completedAt: null,
};

describe("Task #18 — CreateProjectRequestSchema", () => {
  it("accepts a full valid create request", () => {
    expect(S.CreateProjectRequestSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("allows name to be omitted (defaults to repo name server-side)", () => {
    const { name, ...noName } = VALID_CREATE;
    void name;
    expect(S.CreateProjectRequestSchema.safeParse(noName).success).toBe(true);
  });

  it("rejects an unknown visibility or createdFrom, and a missing repo", () => {
    expect(
      S.CreateProjectRequestSchema.safeParse({ ...VALID_CREATE, visibility: "secret" })
        .success,
    ).toBe(false);
    expect(
      S.CreateProjectRequestSchema.safeParse({ ...VALID_CREATE, createdFrom: "nope" })
        .success,
    ).toBe(false);
    expect(
      S.CreateProjectRequestSchema.safeParse({ ...VALID_CREATE, repoName: "" }).success,
    ).toBe(false);
  });
});

describe("Task #18 — CreateProjectResponseSchema", () => {
  it("accepts { projectId, jobId }", () => {
    expect(
      S.CreateProjectResponseSchema.safeParse({ projectId: "p", jobId: "j" }).success,
    ).toBe(true);
    expect(S.CreateProjectResponseSchema.safeParse({ projectId: "p" }).success).toBe(
      false,
    );
  });
});

describe("Task #18 — ProjectJobDtoSchema + params", () => {
  it("accepts a valid job with typed stages", () => {
    expect(S.ProjectJobDtoSchema.safeParse(VALID_JOB).success).toBe(true);
  });

  it("accepts a terminal job with error + completedAt populated", () => {
    expect(
      S.ProjectJobDtoSchema.safeParse({
        ...VALID_JOB,
        status: "failed",
        error: "boom",
        completedAt: "2026-07-19T00:01:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown status or a malformed stage state", () => {
    expect(S.ProjectJobDtoSchema.safeParse({ ...VALID_JOB, status: "weird" }).success).toBe(
      false,
    );
    expect(
      S.ProjectJobDtoSchema.safeParse({
        ...VALID_JOB,
        stages: [{ key: "k", label: "L", state: "bogus" }],
      }).success,
    ).toBe(false);
  });

  it("ProjectJobParamsSchema requires non-empty id + jobId", () => {
    expect(S.ProjectJobParamsSchema.safeParse({ id: "p", jobId: "j" }).success).toBe(true);
    expect(S.ProjectJobParamsSchema.safeParse({ id: "p", jobId: "" }).success).toBe(false);
    expect(S.ProjectJobParamsSchema.safeParse({ id: "", jobId: "j" }).success).toBe(false);
  });
});

describe("Task #18 — ScaffoldProjectPayloadSchema (enqueue contract)", () => {
  const VALID_PAYLOAD = {
    projectId: "cprj1",
    userId: "u1",
    ownerId: "u1",
    installationId: "42",
    repoOwner: "ashtable",
    repoName: "psalm-121",
    repoVisibility: "private",
    createdFrom: "blank",
    slug: "psalm-121",
    name: "Psalm 121",
    manifest: buildBlankManifest(),
  };

  it("round-trips a full payload including the manifest", () => {
    expect(S.ScaffoldProjectPayloadSchema.safeParse(VALID_PAYLOAD).success).toBe(true);
  });

  it("rejects a payload with an invalid manifest or missing installationId", () => {
    expect(
      S.ScaffoldProjectPayloadSchema.safeParse({
        ...VALID_PAYLOAD,
        manifest: { manifestVersion: 2 },
      }).success,
    ).toBe(false);
    const { installationId, ...noInstall } = VALID_PAYLOAD;
    void installationId;
    expect(S.ScaffoldProjectPayloadSchema.safeParse(noInstall).success).toBe(false);
  });
});

describe("Task #18 — barrel exports", () => {
  it("re-exports the new wire DTOs as Zod schemas", () => {
    for (const name of [
      "CreateProjectRequestSchema",
      "CreateProjectResponseSchema",
      "ProjectJobDtoSchema",
      "ProjectJobParamsSchema",
      "ScaffoldProjectPayloadSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
