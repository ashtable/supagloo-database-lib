import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

// Task #22 wire + enqueue DTOs (design-delta §7 workflow 4 / §8): the publish-version
// request/response and the PublishVersionPayload enqueue contract. Unlike commit, publish
// carries NO manifest — the request is `{ message }` only; the working manifest was already
// persisted via prior commitVersionWorkflow calls. The payload carries everything the
// workflow needs before step 1: the installation/repo coordinates, the working `branchName`
// to PR from, and the working version's `semver` (the version being published — it names
// the release tag). DB-free.

const VALID_REQUEST = {
  message: "Publish the shelter cut",
};

const VALID_PAYLOAD = {
  projectId: "cprj1",
  userId: "u1",
  installationId: "42",
  repoOwner: "ashtable",
  repoName: "psalm-91",
  branchName: "v0.0.1",
  semver: "0.0.1",
  message: "Publish the shelter cut",
};

describe("Task #22 — PublishVersionRequestSchema", () => {
  it("accepts a valid { message }", () => {
    expect(S.PublishVersionRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it("rejects an empty or missing message", () => {
    expect(S.PublishVersionRequestSchema.safeParse({ message: "" }).success).toBe(false);
    expect(S.PublishVersionRequestSchema.safeParse({}).success).toBe(false);
  });

  it("carries NO manifest (publish is message-only, unlike commit)", () => {
    const parsed = S.PublishVersionRequestSchema.safeParse(VALID_REQUEST);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("manifest" in parsed.data).toBe(false);
    }
  });
});

describe("Task #22 — PublishVersionResponseSchema", () => {
  it("accepts { jobId }", () => {
    expect(S.PublishVersionResponseSchema.safeParse({ jobId: "j" }).success).toBe(true);
    expect(S.PublishVersionResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #22 — PublishVersionPayloadSchema (enqueue contract)", () => {
  it("round-trips a full publish payload (branchName + semver + message, NO manifest)", () => {
    const parsed = S.PublishVersionPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.branchName).toBe("v0.0.1");
      expect(parsed.data.semver).toBe("0.0.1");
      expect(parsed.data.message).toBe("Publish the shelter cut");
      expect("manifest" in parsed.data).toBe(false);
    }
  });

  it("rejects a payload missing installationId, branchName, or semver", () => {
    for (const key of ["installationId", "branchName", "semver"] as const) {
      const { [key]: _dropped, ...rest } = VALID_PAYLOAD;
      void _dropped;
      expect(S.PublishVersionPayloadSchema.safeParse(rest).success, key).toBe(false);
    }
  });
});

describe("Task #22 — barrel exports", () => {
  it("re-exports the new publish DTOs as Zod schemas", () => {
    for (const name of [
      "PublishVersionRequestSchema",
      "PublishVersionResponseSchema",
      "PublishVersionPayloadSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
