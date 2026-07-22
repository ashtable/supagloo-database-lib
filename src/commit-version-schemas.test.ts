import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

// Task #21 wire + enqueue DTOs (design-delta §7 workflow 3 / §8): the commit-version
// request/response and the CommitVersionPayload enqueue contract. The request carries the
// edited manifest + a commit message; the payload additionally carries everything the
// workflow needs to avoid a DB round-trip before step 1 (branchName + the working
// version's semver + the installation/repo coordinates). The manifest is validated against
// the shared `ProjectManifestSchema`. Per §9-Q10 (broadened in task #30), the scene
// `translation` is any non-empty licensed abbreviation — so a non-KJV/BSB manifest now
// PASSES the boundary (it is validated against the live collection at generation time, not
// this schema); only a structurally-invalid manifest (e.g. empty translation) is rejected
// here with no task-specific work. DB-free.

const VALID_MANIFEST = {
  manifestVersion: 1,
  composition: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  scenes: [
    {
      id: "scene-1",
      name: "Shelter",
      scriptText: "He who dwells in the shelter of the Most High.",
      reference: "Psalm 91:1",
      translation: "BSB",
      visualPrompt: "A traveler resting under a vast starlit desert sky",
      durationSeconds: 5,
      captions: true,
    },
  ],
  narratorVoice: { description: "Warm, reverent male narrator" },
};

const VALID_REQUEST = {
  manifest: VALID_MANIFEST,
  message: "Tighten the shelter scene pacing",
};

const VALID_PAYLOAD = {
  projectId: "cprj1",
  userId: "u1",
  installationId: "42",
  repoOwner: "ashtable",
  repoName: "psalm-91",
  branchName: "v0.0.1",
  semver: "0.0.1",
  manifest: VALID_MANIFEST,
  message: "Tighten the shelter scene pacing",
};

describe("Task #21 — CommitVersionRequestSchema", () => {
  it("accepts a valid { manifest, message }", () => {
    expect(S.CommitVersionRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it("ACCEPTS a non-KJV/BSB manifest (§9-Q10 broadening) but rejects a structurally-invalid one", () => {
    const nivManifest = {
      ...VALID_MANIFEST,
      scenes: [{ ...VALID_MANIFEST.scenes[0], translation: "NIV" }],
    };
    expect(
      S.CommitVersionRequestSchema.safeParse({ ...VALID_REQUEST, manifest: nivManifest })
        .success,
    ).toBe(true);
    const emptyTranslation = {
      ...VALID_MANIFEST,
      scenes: [{ ...VALID_MANIFEST.scenes[0], translation: "" }],
    };
    expect(
      S.CommitVersionRequestSchema.safeParse({ ...VALID_REQUEST, manifest: emptyTranslation })
        .success,
    ).toBe(false);
  });

  it("rejects an empty commit message and a missing manifest", () => {
    expect(
      S.CommitVersionRequestSchema.safeParse({ ...VALID_REQUEST, message: "" }).success,
    ).toBe(false);
    const { manifest, ...noManifest } = VALID_REQUEST;
    void manifest;
    expect(S.CommitVersionRequestSchema.safeParse(noManifest).success).toBe(false);
  });
});

describe("Task #21 — CommitVersionResponseSchema", () => {
  it("accepts { jobId }", () => {
    expect(S.CommitVersionResponseSchema.safeParse({ jobId: "j" }).success).toBe(true);
    expect(S.CommitVersionResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #21 — CommitVersionPayloadSchema (enqueue contract)", () => {
  it("round-trips a full commit payload (manifest + message + branchName + semver)", () => {
    const parsed = S.CommitVersionPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.branchName).toBe("v0.0.1");
      expect(parsed.data.semver).toBe("0.0.1");
      expect(parsed.data.message).toBe("Tighten the shelter scene pacing");
      expect(parsed.data.manifest.scenes[0].name).toBe("Shelter");
    }
  });

  it("rejects a payload missing installationId, branchName, or semver", () => {
    for (const key of ["installationId", "branchName", "semver"] as const) {
      const { [key]: _dropped, ...rest } = VALID_PAYLOAD;
      void _dropped;
      expect(S.CommitVersionPayloadSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("accepts a payload whose manifest carries a non-KJV/BSB translation (§9-Q10)", () => {
    const nivManifest = {
      ...VALID_MANIFEST,
      scenes: [{ ...VALID_MANIFEST.scenes[0], translation: "NIV" }],
    };
    expect(
      S.CommitVersionPayloadSchema.safeParse({ ...VALID_PAYLOAD, manifest: nivManifest })
        .success,
    ).toBe(true);
  });
});

describe("Task #21 — barrel exports", () => {
  it("re-exports the new commit DTOs as Zod schemas", () => {
    for (const name of [
      "CommitVersionRequestSchema",
      "CommitVersionResponseSchema",
      "CommitVersionPayloadSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
