import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  AiGenerationDtoSchema,
  AiGenerationIdParamSchema,
  AiGenerationListResponseSchema,
  AiGenerationResponseSchema,
  CreateAiGenerationRequestSchema,
  CreateAiGenerationResponseSchema,
  GenerateAudioPayloadSchema,
  GenerateImageInputSchema,
  GenerateMusicInputSchema,
  GenerateNarrationInputSchema,
  MediaGenerationInputSchema,
} from "./schemas";

// Task #31: the four-endpoint wire DTOs (design-delta §2.8/§8). The create request is a
// discriminated union on `kind` (structural kind+input validation at the wire boundary →
// 400); the kind→provider matrix is a SEPARATE service check (→ 422). DB-free.

describe("Task #31 CreateAiGenerationRequestSchema", () => {
  it("accepts a valid storyboard request with the real generate-script input", () => {
    const parsed = CreateAiGenerationRequestSchema.safeParse({
      kind: "storyboard",
      provider: "openrouter",
      model: "openai/gpt-4o",
      projectId: "proj_1",
      sceneId: "scene_1",
      input: { brief: "Psalm 121 short" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a script request with optional scripture and no project/scene", () => {
    const parsed = CreateAiGenerationRequestSchema.safeParse({
      kind: "script",
      provider: "gloo",
      model: "gloo/model",
      input: {
        brief: "regenerate the text",
        scripture: { reference: "John 3:16", translation: "KJV" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a text kind whose input is missing the required brief (structural 400)", () => {
    const parsed = CreateAiGenerationRequestSchema.safeParse({
      kind: "storyboard",
      provider: "openrouter",
      model: "m",
      input: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a still-placeholder media kind (video) with arbitrary passthrough input (contract deferred to #34)", () => {
    const parsed = CreateAiGenerationRequestSchema.safeParse({
      kind: "video",
      provider: "openrouter",
      model: "some/video-model",
      input: { anything: "goes", nested: { ok: true } },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a real narration spec (voice + at least one scene) now that narration is wired (Task #33)", () => {
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "narration",
        provider: "openrouter",
        model: "some/speech-model",
        projectId: "proj_1",
        input: {
          voice: { description: "warm, weathered baritone", label: "JEJ-STYLE" },
          scenes: [
            { sceneId: "s1", scriptText: "I am the voice of one" },
            { sceneId: "s2", scriptText: "crying in the wilderness" },
          ],
          extra: "tolerated by passthrough",
        },
      }).success,
    ).toBe(true);
    // Empty input is no longer accepted (was a passthrough placeholder pre-#33).
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "narration",
        provider: "openrouter",
        model: "some/speech-model",
        input: {},
      }).success,
    ).toBe(false);
    // A voice with no scenes fails the min(1) scenes constraint.
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "narration",
        provider: "openrouter",
        model: "some/speech-model",
        input: { voice: { description: "x" }, scenes: [] },
      }).success,
    ).toBe(false);
  });

  it("requires a real music spec (style + positive duration) now that music is wired (Task #33)", () => {
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "music",
        provider: "openrouter",
        model: "some/music-model",
        projectId: "proj_1",
        input: { style: "Swelling strings", durationSeconds: 30, tempo: "andante" },
      }).success,
    ).toBe(true);
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "music",
        provider: "openrouter",
        model: "some/music-model",
        input: {},
      }).success,
    ).toBe(false);
    // Non-positive duration fails.
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "music",
        provider: "openrouter",
        model: "some/music-model",
        input: { style: "ambient", durationSeconds: 0 },
      }).success,
    ).toBe(false);
  });

  it("GenerateNarrationInputSchema / GenerateMusicInputSchema are passthrough over the specs", () => {
    expect(
      GenerateNarrationInputSchema.safeParse({
        voice: { description: "x" },
        scenes: [{ sceneId: "s1", scriptText: "hello" }],
      }).success,
    ).toBe(true);
    expect(GenerateNarrationInputSchema.safeParse({ scenes: [] }).success).toBe(false);
    expect(
      GenerateMusicInputSchema.safeParse({ style: "calm", durationSeconds: 12 }).success,
    ).toBe(true);
    expect(GenerateMusicInputSchema.safeParse({ style: "" }).success).toBe(false);
  });

  it("GenerateAudioPayloadSchema is the { generationId } enqueue echo", () => {
    expect(GenerateAudioPayloadSchema.parse({ generationId: "gen_1" })).toEqual({
      generationId: "gen_1",
    });
    expect(GenerateAudioPayloadSchema.safeParse({ generationId: "" }).success).toBe(false);
  });

  it("requires a prompt for the image kind now that it has a real input schema (Task #32)", () => {
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "image",
        provider: "openrouter",
        model: "some/image-model",
        input: { prompt: "a serene sunrise over hills", extra: "ok" },
      }).success,
    ).toBe(true);
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "image",
        provider: "openrouter",
        model: "some/image-model",
        input: {},
      }).success,
    ).toBe(false);
  });

  it("accepts image+gloo STRUCTURALLY when the prompt is present (the matrix 422 is a service check, not this union)", () => {
    const parsed = CreateAiGenerationRequestSchema.safeParse({
      kind: "image",
      provider: "gloo",
      model: "m",
      input: { prompt: "x" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown kind and an unknown provider", () => {
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "hologram",
        provider: "openrouter",
        model: "m",
        input: {},
      }).success,
    ).toBe(false);
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "script",
        provider: "anthropic",
        model: "m",
        input: { brief: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects a missing/empty model", () => {
    expect(
      CreateAiGenerationRequestSchema.safeParse({
        kind: "script",
        provider: "gloo",
        model: "",
        input: { brief: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("Task #32 GenerateImageInputSchema — the real image input", () => {
  it("accepts a non-empty prompt", () => {
    expect(
      GenerateImageInputSchema.parse({ prompt: "a serene sunrise over hills" }),
    ).toMatchObject({ prompt: "a serene sunrise over hills" });
  });

  it("rejects a missing or empty prompt", () => {
    expect(GenerateImageInputSchema.safeParse({}).success).toBe(false);
    expect(GenerateImageInputSchema.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("tolerates extra keys (passthrough so #33-34 richer contracts can extend it)", () => {
    const parsed = GenerateImageInputSchema.parse({
      prompt: "x",
      size: "1024x1024",
      seed: 7,
    });
    expect(parsed.prompt).toBe("x");
    expect((parsed as Record<string, unknown>).size).toBe("1024x1024");
  });
});

describe("Task #31 AiGenerationDtoSchema", () => {
  it("round-trips a full DTO incl. arbitrary resultJson + tokenUsage", () => {
    const dto = {
      id: "gen_1",
      projectId: "proj_1",
      sceneId: "scene_1",
      kind: "storyboard" as const,
      provider: "openrouter" as const,
      model: "openai/gpt-4o",
      status: "succeeded" as const,
      resultJson: { scenes: [{ name: "s1" }], musicStyle: "calm" },
      resultAssetKey: null,
      error: null,
      tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const parsed = AiGenerationDtoSchema.parse(dto);
    expect(parsed.resultJson).toEqual(dto.resultJson);
    expect(parsed.tokenUsage).toEqual(dto.tokenUsage);
  });

  it("accepts the nullable fields as null (a queued generation with no project/scene)", () => {
    const parsed = AiGenerationDtoSchema.safeParse({
      id: "gen_2",
      projectId: null,
      sceneId: null,
      kind: "script",
      provider: "gloo",
      model: "m",
      status: "queued",
      resultJson: null,
      resultAssetKey: null,
      error: null,
      tokenUsage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Task #31 response / list / param schemas", () => {
  it("CreateAiGenerationResponseSchema carries the generationId", () => {
    expect(
      CreateAiGenerationResponseSchema.parse({ generationId: "gen_1" }),
    ).toEqual({ generationId: "gen_1" });
  });

  it("AiGenerationResponseSchema wraps a single DTO", () => {
    const parsed = AiGenerationResponseSchema.safeParse({
      generation: {
        id: "g",
        projectId: null,
        sceneId: null,
        kind: "script",
        provider: "gloo",
        model: "m",
        status: "queued",
        resultJson: null,
        resultAssetKey: null,
        error: null,
        tokenUsage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("AiGenerationListResponseSchema wraps an array", () => {
    expect(
      AiGenerationListResponseSchema.parse({ generations: [] }),
    ).toEqual({ generations: [] });
  });

  it("AiGenerationIdParamSchema requires a non-empty id", () => {
    expect(AiGenerationIdParamSchema.safeParse({ id: "x" }).success).toBe(true);
    expect(AiGenerationIdParamSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("MediaGenerationInputSchema is a passthrough object", () => {
    expect(MediaGenerationInputSchema.parse({ a: 1 })).toEqual({ a: 1 });
    expect(MediaGenerationInputSchema.safeParse("nope").success).toBe(false);
  });
});

describe("Task #31 schemas are re-exported from the barrel", () => {
  it("exposes each schema on the package index", () => {
    expect(DbLib.CreateAiGenerationRequestSchema).toBe(
      CreateAiGenerationRequestSchema,
    );
    expect(DbLib.AiGenerationDtoSchema).toBe(AiGenerationDtoSchema);
    expect(DbLib.AiGenerationResponseSchema).toBe(AiGenerationResponseSchema);
    expect(DbLib.AiGenerationListResponseSchema).toBe(
      AiGenerationListResponseSchema,
    );
    expect(DbLib.CreateAiGenerationResponseSchema).toBe(
      CreateAiGenerationResponseSchema,
    );
    expect(DbLib.AiGenerationIdParamSchema).toBe(AiGenerationIdParamSchema);
    expect(DbLib.MediaGenerationInputSchema).toBe(MediaGenerationInputSchema);
    expect(DbLib.GenerateImageInputSchema).toBe(GenerateImageInputSchema);
  });
});
