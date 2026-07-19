import { describe, expect, it } from "vitest";
// Namespace import of the package barrel — proves the new Files wire DTOs and the
// shared S3 key helpers are re-exported from the package entry.
import * as DbLib from "./index";
import * as S from "./schemas";

// Unit tests for the Task #13 Files WIRE DTOs (design-delta §4/§8). DB-free — pure
// Zod accept/reject + barrel-export checks. There is no `File` Prisma model, so no
// collision rule applies (unlike the connection DTOs).

describe("Task #13 wire DTOs — presign download", () => {
  it("FilePresignDownloadQuerySchema requires a non-empty key", () => {
    expect(
      S.FilePresignDownloadQuerySchema.safeParse({
        key: "projects/p1/assets/a1",
      }).success,
    ).toBe(true);
    expect(S.FilePresignDownloadQuerySchema.safeParse({}).success).toBe(false);
    expect(
      S.FilePresignDownloadQuerySchema.safeParse({ key: "" }).success,
    ).toBe(false);
  });

  it("FilePresignDownloadResponseSchema requires url + expiresAt", () => {
    expect(
      S.FilePresignDownloadResponseSchema.safeParse({
        url: "http://localhost:9000/supagloo-dev/projects/p1/assets/a1?X-Amz-Signature=abc",
        expiresAt: "2026-07-18T00:05:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      S.FilePresignDownloadResponseSchema.safeParse({ url: "http://x" }).success,
    ).toBe(false);
    expect(S.FilePresignDownloadResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Task #13 barrel exports", () => {
  it("re-exports the Files wire DTOs as Zod schemas", () => {
    for (const name of [
      "FilePresignDownloadQuerySchema",
      "FilePresignDownloadResponseSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[
        name
      ];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });

  it("re-exports the shared S3 key helpers as functions", () => {
    expect(typeof DbLib.buildAssetKey).toBe("function");
    expect(typeof DbLib.buildRenderOutputKey).toBe("function");
    expect(typeof DbLib.buildRenderThumbnailKey).toBe("function");
    expect(typeof DbLib.parseS3Key).toBe("function");
  });
});
