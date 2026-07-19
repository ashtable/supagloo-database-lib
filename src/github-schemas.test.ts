import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new GitHub-connection wire
// DTOs are re-exported from the package entry and do NOT collide with the
// re-exported Prisma `GithubConnection` model type.
import * as DbLib from "./index";
import * as S from "./schemas";

// Unit tests for the Task #11 GitHub-connection WIRE DTOs (design-delta
// §2.3/§6a/§8). DB-free — pure Zod accept/reject + barrel-export checks.

const validConnection = {
  githubLogin: "acme",
  installationId: "42",
  repositorySelection: "selected",
  status: "connected",
  connectedAt: "2026-07-18T00:00:00.000Z",
};

const validRepo = {
  id: 101,
  name: "psalms-video",
  fullName: "acme/psalms-video",
  owner: "acme",
  private: true,
  defaultBranch: "main",
  empty: false,
};

describe("Task #11 wire DTOs — install url + callback request", () => {
  it("GithubInstallUrlResponseSchema requires a url", () => {
    expect(
      S.GithubInstallUrlResponseSchema.safeParse({
        url: "https://github.com/apps/supagloo/installations/new",
      }).success,
    ).toBe(true);
    expect(S.GithubInstallUrlResponseSchema.safeParse({}).success).toBe(false);
  });

  it("GithubCallbackRequestSchema accepts installationId as string or number", () => {
    const asString = S.GithubCallbackRequestSchema.safeParse({
      installationId: "42",
    });
    expect(asString.success).toBe(true);
    expect(asString.success && asString.data.installationId).toBe("42");

    const asNumber = S.GithubCallbackRequestSchema.safeParse({
      installationId: 42,
    });
    expect(asNumber.success).toBe(true);
    expect(asNumber.success && asNumber.data.installationId).toBe("42");

    expect(S.GithubCallbackRequestSchema.safeParse({}).success).toBe(false);
    expect(
      S.GithubCallbackRequestSchema.safeParse({ installationId: "" }).success,
    ).toBe(false);
  });
});

describe("Task #11 wire DTOs — connection status + disconnect", () => {
  it("GithubConnectionStatusSchema parses a stored connection (ISO connectedAt)", () => {
    expect(S.GithubConnectionStatusSchema.safeParse(validConnection).success).toBe(
      true,
    );
    const { installationId: _drop, ...noId } = validConnection;
    expect(S.GithubConnectionStatusSchema.safeParse(noId).success).toBe(false);
  });

  it("GithubConnectionResponseSchema wraps a connection", () => {
    expect(
      S.GithubConnectionResponseSchema.safeParse({ connection: validConnection })
        .success,
    ).toBe(true);
    expect(S.GithubConnectionResponseSchema.safeParse({}).success).toBe(false);
  });

  it("GithubDisconnectResponseSchema is exactly { ok: true }", () => {
    expect(S.GithubDisconnectResponseSchema.safeParse({ ok: true }).success).toBe(
      true,
    );
    expect(
      S.GithubDisconnectResponseSchema.safeParse({ ok: false }).success,
    ).toBe(false);
  });
});

describe("Task #11 wire DTOs — repo listing + filter enum", () => {
  it("GithubRepoFilterSchema is a closed empty|all enum", () => {
    expect(S.GithubRepoFilterSchema.safeParse("empty").success).toBe(true);
    expect(S.GithubRepoFilterSchema.safeParse("all").success).toBe(true);
    expect(S.GithubRepoFilterSchema.safeParse("mine").success).toBe(false);
    expect(S.GithubRepoFilterSchema.safeParse("").success).toBe(false);
  });

  it("GithubRepoSchema parses a normalized repo item", () => {
    expect(S.GithubRepoSchema.safeParse(validRepo).success).toBe(true);
    expect(
      S.GithubRepoSchema.safeParse({ ...validRepo, empty: "no" }).success,
    ).toBe(false);
  });

  it("GithubRepoListResponseSchema wraps an array of repos", () => {
    expect(
      S.GithubRepoListResponseSchema.safeParse({ repositories: [validRepo] })
        .success,
    ).toBe(true);
    expect(
      S.GithubRepoListResponseSchema.safeParse({ repositories: [] }).success,
    ).toBe(true);
    expect(S.GithubRepoListResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #11 wire DTOs — barrel exports (no Prisma collision)", () => {
  const exported = [
    "GithubInstallUrlResponseSchema",
    "GithubCallbackRequestSchema",
    "GithubConnectionStatusSchema",
    "GithubConnectionResponseSchema",
    "GithubDisconnectResponseSchema",
    "GithubRepoSchema",
    "GithubRepoListResponseSchema",
    "GithubRepoFilterSchema",
  ] as const;

  it("re-exports every GitHub-connection DTO from the package entry", () => {
    const lib = DbLib as unknown as Record<
      string,
      { safeParse?: unknown } | undefined
    >;
    for (const name of exported) {
      const schema = lib[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });

  it("still re-exports the shared GitHub App primitives", () => {
    expect(typeof DbLib.signAppJwt).toBe("function");
    expect(typeof DbLib.mintInstallationToken).toBe("function");
  });
});
