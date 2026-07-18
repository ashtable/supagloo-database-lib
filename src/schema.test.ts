import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Prisma } from "./index";

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
