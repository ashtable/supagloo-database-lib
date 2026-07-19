import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new OpenRouter/Gloo
// connection wire DTOs are re-exported from the package entry and do NOT collide
// with the re-exported Prisma `OpenRouterConnection` / `GlooConnection` model types.
import * as DbLib from "./index";
import * as S from "./schemas";

// Unit tests for the Task #12 OpenRouter + Gloo connection WIRE DTOs (design-delta
// §2.5/§8). DB-free — pure Zod accept/reject + barrel-export checks. The wire types
// are `*ConnectionStatus`-suffixed (never bare `*Connection`), same collision rule
// as Task #11's `GithubConnectionStatus`.

const validOpenRouterStatus = {
  keyLast4: "wxyz",
  status: "connected",
  connectedAt: "2026-07-18T00:00:00.000Z",
};

const validGlooStatus = {
  clientId: "gloo-client-abc",
  status: "connected",
  connectedAt: "2026-07-18T00:00:00.000Z",
  lastVerifiedAt: "2026-07-18T00:00:00.000Z",
};

describe("Task #12 wire DTOs — OpenRouter", () => {
  it("OpenRouterConnectRequestSchema requires a non-empty key", () => {
    expect(
      S.OpenRouterConnectRequestSchema.safeParse({ key: "sk-or-v1-abc" }).success,
    ).toBe(true);
    expect(S.OpenRouterConnectRequestSchema.safeParse({}).success).toBe(false);
    expect(S.OpenRouterConnectRequestSchema.safeParse({ key: "" }).success).toBe(
      false,
    );
  });

  it("OpenRouterConnectionStatusSchema parses a masked status (keyLast4, no ciphertext)", () => {
    expect(
      S.OpenRouterConnectionStatusSchema.safeParse(validOpenRouterStatus).success,
    ).toBe(true);
    const { keyLast4: _drop, ...noLast4 } = validOpenRouterStatus;
    expect(S.OpenRouterConnectionStatusSchema.safeParse(noLast4).success).toBe(
      false,
    );
    // The wire status must NOT carry a ciphertext/secret field — the schema is
    // closed by object() default (strip), so a ciphertext key is simply dropped;
    // assert the parsed shape never surfaces it.
    const parsed = S.OpenRouterConnectionStatusSchema.parse({
      ...validOpenRouterStatus,
      apiKeyCiphertext: "LEAK",
    });
    expect(Object.keys(parsed)).not.toContain("apiKeyCiphertext");
  });

  it("OpenRouterCreditsResponseSchema requires the three numeric fields", () => {
    expect(
      S.OpenRouterCreditsResponseSchema.safeParse({
        totalCredits: 100,
        totalUsage: 12.5,
        remaining: 87.5,
      }).success,
    ).toBe(true);
    expect(
      S.OpenRouterCreditsResponseSchema.safeParse({
        totalCredits: 100,
        totalUsage: 12.5,
      }).success,
    ).toBe(false);
    expect(
      S.OpenRouterCreditsResponseSchema.safeParse({
        totalCredits: "100",
        totalUsage: 12.5,
        remaining: 87.5,
      }).success,
    ).toBe(false);
  });

  it("OpenRouterConnectionResponseSchema wraps a connection; disconnect is { ok: true }", () => {
    expect(
      S.OpenRouterConnectionResponseSchema.safeParse({
        connection: validOpenRouterStatus,
      }).success,
    ).toBe(true);
    expect(S.OpenRouterConnectionResponseSchema.safeParse({}).success).toBe(false);
    expect(
      S.OpenRouterDisconnectResponseSchema.safeParse({ ok: true }).success,
    ).toBe(true);
    expect(
      S.OpenRouterDisconnectResponseSchema.safeParse({ ok: false }).success,
    ).toBe(false);
  });
});

describe("Task #12 wire DTOs — Gloo", () => {
  it("GlooConnectRequestSchema requires clientId + clientSecret", () => {
    expect(
      S.GlooConnectRequestSchema.safeParse({
        clientId: "id",
        clientSecret: "secret",
      }).success,
    ).toBe(true);
    expect(
      S.GlooConnectRequestSchema.safeParse({ clientId: "id" }).success,
    ).toBe(false);
    expect(
      S.GlooConnectRequestSchema.safeParse({
        clientId: "",
        clientSecret: "secret",
      }).success,
    ).toBe(false);
  });

  it("GlooConnectionStatusSchema parses clientId + timestamps (never the secret)", () => {
    expect(S.GlooConnectionStatusSchema.safeParse(validGlooStatus).success).toBe(
      true,
    );
    const { lastVerifiedAt: _drop, ...noVerified } = validGlooStatus;
    expect(S.GlooConnectionStatusSchema.safeParse(noVerified).success).toBe(false);
    const parsed = S.GlooConnectionStatusSchema.parse({
      ...validGlooStatus,
      clientSecretCiphertext: "LEAK",
    });
    expect(Object.keys(parsed)).not.toContain("clientSecretCiphertext");
  });

  it("GlooConnectionResponseSchema wraps a connection; disconnect is { ok: true }", () => {
    expect(
      S.GlooConnectionResponseSchema.safeParse({ connection: validGlooStatus })
        .success,
    ).toBe(true);
    expect(S.GlooConnectionResponseSchema.safeParse({}).success).toBe(false);
    expect(S.GlooDisconnectResponseSchema.safeParse({ ok: true }).success).toBe(
      true,
    );
    expect(S.GlooDisconnectResponseSchema.safeParse({ ok: false }).success).toBe(
      false,
    );
  });
});

describe("Task #12 wire DTOs — merged connections", () => {
  it("ConnectionsResponseSchema accepts all-null (nothing connected)", () => {
    expect(
      S.ConnectionsResponseSchema.safeParse({
        github: null,
        openrouter: null,
        gloo: null,
      }).success,
    ).toBe(true);
  });

  it("ConnectionsResponseSchema accepts a mixed set of connected providers", () => {
    expect(
      S.ConnectionsResponseSchema.safeParse({
        github: {
          githubLogin: "acme",
          installationId: "42",
          repositorySelection: "selected",
          status: "connected",
          connectedAt: "2026-07-18T00:00:00.000Z",
        },
        openrouter: validOpenRouterStatus,
        gloo: validGlooStatus,
      }).success,
    ).toBe(true);
  });

  it("ConnectionsResponseSchema requires every provider key to be present", () => {
    expect(
      S.ConnectionsResponseSchema.safeParse({
        openrouter: null,
        gloo: null,
      }).success,
    ).toBe(false);
  });
});

describe("Task #12 wire DTOs — barrel exports (no Prisma collision)", () => {
  const exported = [
    "OpenRouterConnectRequestSchema",
    "OpenRouterConnectionStatusSchema",
    "OpenRouterCreditsResponseSchema",
    "OpenRouterConnectionResponseSchema",
    "OpenRouterDisconnectResponseSchema",
    "GlooConnectRequestSchema",
    "GlooConnectionStatusSchema",
    "GlooConnectionResponseSchema",
    "GlooDisconnectResponseSchema",
    "ConnectionsResponseSchema",
  ] as const;

  it("re-exports every OpenRouter/Gloo connection DTO from the package entry", () => {
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

  it("still re-exports the shared secrets primitives (consumed by the services)", () => {
    expect(typeof DbLib.encryptSecret).toBe("function");
    expect(typeof DbLib.decryptSecret).toBe("function");
  });
});
