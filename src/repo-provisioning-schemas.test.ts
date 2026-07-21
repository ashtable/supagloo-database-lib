import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

// Task #26 wire DTOs (design-delta §2.3/§6b/§8): the create-new-repo JIT hop —
// the user-authorization-URL response + the code-exchange-and-create-repo request.
// The response of the create-repo endpoint reuses CreateProjectResponseSchema
// ({ projectId, jobId }). DB-free — pure Zod accept/reject + barrel-export checks.

const VALID_CREATE_REPO = {
  code: "gh-user-auth-code",
  name: "Psalm 121",
  repoName: "psalm-121",
  visibility: "private",
  createdFrom: "blank",
};

describe("Task #26 — RepoAuthorizeUrlQuerySchema", () => {
  it("accepts a redirectUri + state", () => {
    expect(
      S.RepoAuthorizeUrlQuerySchema.safeParse({
        redirectUri: "https://app.example/connect/github/create-repo/callback",
        state: "nonce-1",
      }).success,
    ).toBe(true);
  });

  it("rejects a blank redirectUri or state", () => {
    expect(
      S.RepoAuthorizeUrlQuerySchema.safeParse({ redirectUri: "", state: "n" }).success,
    ).toBe(false);
    expect(
      S.RepoAuthorizeUrlQuerySchema.safeParse({ redirectUri: "https://x", state: "" })
        .success,
    ).toBe(false);
  });
});

describe("Task #26 — RepoAuthorizeUrlResponseSchema", () => {
  it("accepts { url }", () => {
    expect(
      S.RepoAuthorizeUrlResponseSchema.safeParse({ url: "https://github.com/login/oauth" })
        .success,
    ).toBe(true);
    expect(S.RepoAuthorizeUrlResponseSchema.safeParse({ url: "" }).success).toBe(false);
  });
});

describe("Task #26 — CreateRepoRequestSchema", () => {
  it("accepts a full valid create-repo request", () => {
    expect(S.CreateRepoRequestSchema.safeParse(VALID_CREATE_REPO).success).toBe(true);
  });

  it("allows name to be omitted (defaults to repo name server-side)", () => {
    const { name, ...noName } = VALID_CREATE_REPO;
    void name;
    expect(S.CreateRepoRequestSchema.safeParse(noName).success).toBe(true);
  });

  it("rejects a missing code, unknown visibility/createdFrom, or blank repoName", () => {
    const { code, ...noCode } = VALID_CREATE_REPO;
    void code;
    expect(S.CreateRepoRequestSchema.safeParse(noCode).success).toBe(false);
    expect(
      S.CreateRepoRequestSchema.safeParse({ ...VALID_CREATE_REPO, visibility: "secret" })
        .success,
    ).toBe(false);
    expect(
      S.CreateRepoRequestSchema.safeParse({ ...VALID_CREATE_REPO, createdFrom: "nope" })
        .success,
    ).toBe(false);
    expect(
      S.CreateRepoRequestSchema.safeParse({ ...VALID_CREATE_REPO, repoName: "" }).success,
    ).toBe(false);
  });
});

describe("Task #26 — barrel exports", () => {
  it("re-exports the new JIT-hop wire DTOs as Zod schemas", () => {
    for (const name of [
      "RepoAuthorizeUrlQuerySchema",
      "RepoAuthorizeUrlResponseSchema",
      "CreateRepoRequestSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
