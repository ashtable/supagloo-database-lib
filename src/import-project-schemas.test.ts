import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

// Task #19 wire + enqueue DTOs (design-delta §7 workflow 2 / §8): the import-project
// request/response and the ImportProjectPayload enqueue contract. Import discovers the
// manifest + createdFrom from the cloned repo, so — unlike the scaffold payload — the
// payload carries NEITHER a `manifest` NOR a `createdFrom`. DB-free — pure Zod
// accept/reject + barrel-export checks.

const VALID_IMPORT = {
  name: "Imported Psalm",
  repoOwner: "ashtable",
  repoName: "psalm-121",
  visibility: "private",
};

const VALID_IMPORT_PAYLOAD = {
  projectId: "cprj1",
  userId: "u1",
  ownerId: "u1",
  installationId: "42",
  repoOwner: "ashtable",
  repoName: "psalm-121",
  repoVisibility: "private",
  slug: "psalm-121",
  name: "Imported Psalm",
};

describe("Task #19 — ImportProjectRequestSchema", () => {
  it("accepts a full valid import request", () => {
    expect(S.ImportProjectRequestSchema.safeParse(VALID_IMPORT).success).toBe(true);
  });

  it("allows name to be omitted (defaults to repo name server-side)", () => {
    const { name, ...noName } = VALID_IMPORT;
    void name;
    expect(S.ImportProjectRequestSchema.safeParse(noName).success).toBe(true);
  });

  it("rejects an unknown visibility or a missing repo owner/name", () => {
    expect(
      S.ImportProjectRequestSchema.safeParse({ ...VALID_IMPORT, visibility: "secret" })
        .success,
    ).toBe(false);
    expect(
      S.ImportProjectRequestSchema.safeParse({ ...VALID_IMPORT, repoName: "" }).success,
    ).toBe(false);
    expect(
      S.ImportProjectRequestSchema.safeParse({ ...VALID_IMPORT, repoOwner: "" }).success,
    ).toBe(false);
  });

  it("does NOT carry a createdFrom (import is always 'import')", () => {
    const parsed = S.ImportProjectRequestSchema.parse(VALID_IMPORT);
    expect("createdFrom" in parsed).toBe(false);
  });
});

describe("Task #19 — ImportProjectResponseSchema", () => {
  it("accepts { projectId, jobId }", () => {
    expect(
      S.ImportProjectResponseSchema.safeParse({ projectId: "p", jobId: "j" }).success,
    ).toBe(true);
    expect(S.ImportProjectResponseSchema.safeParse({ projectId: "p" }).success).toBe(
      false,
    );
  });
});

describe("Task #19 — ImportProjectPayloadSchema (enqueue contract)", () => {
  it("round-trips a full import payload", () => {
    expect(S.ImportProjectPayloadSchema.safeParse(VALID_IMPORT_PAYLOAD).success).toBe(
      true,
    );
  });

  it("has NO manifest / createdFrom fields (discovered from the repo, not the request)", () => {
    const parsed = S.ImportProjectPayloadSchema.parse(VALID_IMPORT_PAYLOAD);
    expect("manifest" in parsed).toBe(false);
    expect("createdFrom" in parsed).toBe(false);
    // A caller who bolts a manifest on gets it stripped, not accepted as payload data.
    const withManifest = S.ImportProjectPayloadSchema.parse({
      ...VALID_IMPORT_PAYLOAD,
      manifest: { manifestVersion: 1 },
    });
    expect("manifest" in withManifest).toBe(false);
  });

  it("rejects a payload missing installationId or repoVisibility", () => {
    const { installationId, ...noInstall } = VALID_IMPORT_PAYLOAD;
    void installationId;
    expect(S.ImportProjectPayloadSchema.safeParse(noInstall).success).toBe(false);
    const { repoVisibility, ...noVis } = VALID_IMPORT_PAYLOAD;
    void repoVisibility;
    expect(S.ImportProjectPayloadSchema.safeParse(noVis).success).toBe(false);
  });
});

describe("Task #19 — barrel exports", () => {
  it("re-exports the new import DTOs as Zod schemas", () => {
    for (const name of [
      "ImportProjectRequestSchema",
      "ImportProjectResponseSchema",
      "ImportProjectPayloadSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
