import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new Manifest-read wire DTOs
// are re-exported from the package entry.
import * as DbLib from "./index";
import * as S from "./schemas";
import { buildBlankManifest } from "./manifest-defaults";

// Unit tests for the Task #20 Manifest-read WIRE DTOs (design-delta §5.3/§8). DB-free —
// pure Zod accept/reject + barrel-export checks. There is no `Manifest` Prisma model,
// so no barrel-collision suffix rule applies (unlike the connection DTOs). The response
// DTO reuses the task-7 `ProjectManifestSchema`.

describe("Task #20 wire DTOs — manifest read", () => {
  it("ManifestRefQuerySchema makes ref an OPTIONAL non-empty string", () => {
    expect(S.ManifestRefQuerySchema.safeParse({ ref: "v0.0.1" }).success).toBe(true);
    // omitted ref is valid (the API defaults it to the project's currentBranch).
    expect(S.ManifestRefQuerySchema.safeParse({}).success).toBe(true);
    // an explicit empty ref is rejected (min 1).
    expect(S.ManifestRefQuerySchema.safeParse({ ref: "" }).success).toBe(false);
  });

  it("ManifestResponseSchema requires a schema-valid manifest", () => {
    expect(
      S.ManifestResponseSchema.safeParse({ manifest: buildBlankManifest() }).success,
    ).toBe(true);
    // wrong manifestVersion → the nested ProjectManifestSchema rejects it.
    expect(
      S.ManifestResponseSchema.safeParse({
        manifest: { ...buildBlankManifest(), manifestVersion: 2 },
      }).success,
    ).toBe(false);
    expect(S.ManifestResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #20 barrel exports", () => {
  it("re-exports the Manifest-read wire DTOs as Zod schemas", () => {
    for (const name of [
      "ManifestRefQuerySchema",
      "ManifestResponseSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[
        name
      ];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
