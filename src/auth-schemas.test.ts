import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new wire DTOs are
// re-exported from the package entry (the `export * from "./schemas"` path) and
// do NOT collide with the re-exported Prisma `User`/`Session` model types.
import * as DbLib from "./index";
// The schemas under test. Until these are added to src/schemas.ts the named
// members are `undefined` and `.safeParse` throws — the intended clean RED.
import * as S from "./schemas";

// Unit tests for the Task #10 auth/session WIRE DTOs (design-delta §2.11 + §6a).
// These are the FIRST request/response DTOs in database-lib (existing schemas are
// domain/content only). DB-free — pure Zod accept/reject + barrel-export checks.

const validAuthUser = {
  id: "clx0000000000000000000000",
  youversionUserId: "yv-user-1001",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  avatarInitials: "AL",
  firstSignInAt: "2026-07-18T00:00:00.000Z",
  onboardingCompletedAt: null,
  lastSeenAt: "2026-07-18T00:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("Task #10 wire DTOs — AuthUserSchema", () => {
  it("parses a valid wire user (ISO date strings, nullable onboarding)", () => {
    const res = S.AuthUserSchema.safeParse(validAuthUser);
    expect(res.success, JSON.stringify(res)).toBe(true);
  });

  it("accepts a non-null onboardingCompletedAt", () => {
    expect(
      S.AuthUserSchema.safeParse({
        ...validAuthUser,
        onboardingCompletedAt: "2026-07-18T01:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a missing required field and a non-string id", () => {
    const { email: _drop, ...noEmail } = validAuthUser;
    expect(S.AuthUserSchema.safeParse(noEmail).success).toBe(false);
    expect(
      S.AuthUserSchema.safeParse({ ...validAuthUser, id: 123 }).success,
    ).toBe(false);
  });
});

describe("Task #10 wire DTOs — sign-in request/response", () => {
  it("YouVersionSignInRequestSchema requires a non-empty accessToken", () => {
    expect(
      S.YouVersionSignInRequestSchema.safeParse({ accessToken: "abc" }).success,
    ).toBe(true);
    expect(
      S.YouVersionSignInRequestSchema.safeParse({ accessToken: "" }).success,
    ).toBe(false);
    expect(S.YouVersionSignInRequestSchema.safeParse({}).success).toBe(false);
  });

  it("YouVersionSignInResponseSchema requires token + user + firstSignIn", () => {
    const ok = {
      token: "opaque-session-token",
      user: validAuthUser,
      firstSignIn: true,
    };
    expect(
      S.YouVersionSignInResponseSchema.safeParse(ok).success,
      JSON.stringify(S.YouVersionSignInResponseSchema.safeParse(ok)),
    ).toBe(true);
    const { firstSignIn: _f, ...noFlag } = ok;
    expect(S.YouVersionSignInResponseSchema.safeParse(noFlag).success).toBe(false);
    expect(
      S.YouVersionSignInResponseSchema.safeParse({ ...ok, token: "" }).success,
    ).toBe(false);
  });
});

describe("Task #10 wire DTOs — me / onboarding / signout", () => {
  it("MeResponseSchema and OnboardingResponseSchema wrap a user", () => {
    expect(S.MeResponseSchema.safeParse({ user: validAuthUser }).success).toBe(
      true,
    );
    expect(
      S.OnboardingResponseSchema.safeParse({ user: validAuthUser }).success,
    ).toBe(true);
    expect(S.MeResponseSchema.safeParse({}).success).toBe(false);
  });

  it("SignoutResponseSchema is exactly { ok: true }", () => {
    expect(S.SignoutResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(S.SignoutResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(S.SignoutResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #10 wire DTOs — test/seed", () => {
  const validUser = {
    youversionUserId: "yv-seed-1",
    displayName: "Seed One",
    email: "seed1@example.test",
    avatarInitials: "SO",
    sessionToken: "seed-token-1",
  };

  it("TestSeedRequestSchema requires >=1 user, each with a session token", () => {
    expect(
      S.TestSeedRequestSchema.safeParse({ users: [validUser] }).success,
    ).toBe(true);
    expect(
      S.TestSeedRequestSchema.safeParse({
        users: [{ ...validUser, onboardingCompleted: true }],
      }).success,
    ).toBe(true);
    expect(S.TestSeedRequestSchema.safeParse({ users: [] }).success).toBe(false);
    const { sessionToken: _s, ...noToken } = validUser;
    expect(
      S.TestSeedRequestSchema.safeParse({ users: [noToken] }).success,
    ).toBe(false);
  });

  it("TestSeedResponseSchema returns users with their tokens", () => {
    expect(
      S.TestSeedResponseSchema.safeParse({
        users: [{ user: validAuthUser, token: "seed-token-1" }],
      }).success,
    ).toBe(true);
    expect(S.TestSeedResponseSchema.safeParse({ users: [] }).success).toBe(false);
  });
});

describe("Task #10 wire DTOs — barrel exports (no Prisma collision)", () => {
  const exported = [
    "AuthUserSchema",
    "YouVersionSignInRequestSchema",
    "YouVersionSignInResponseSchema",
    "MeResponseSchema",
    "OnboardingResponseSchema",
    "SignoutResponseSchema",
    "TestSeedRequestSchema",
    "TestSeedResponseSchema",
  ] as const;

  it("re-exports every wire DTO from the package entry as a usable Zod schema", () => {
    const lib = DbLib as unknown as Record<
      string,
      { parse?: unknown; safeParse?: unknown } | undefined
    >;
    for (const name of exported) {
      const schema = lib[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });

  it("still re-exports the Prisma User/Session model types (no name clash)", () => {
    // The wire user is `AuthUser`, NOT `User`, precisely so `export *` of the
    // generated Prisma client keeps working. These are the Prisma enum/const
    // barrels; presence proves the star-export is intact.
    expect(DbLib.JobStatus).toBeDefined();
  });
});
