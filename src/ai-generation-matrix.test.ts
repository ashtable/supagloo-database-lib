import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  AI_PROVIDERS_BY_KIND,
  isProviderCompatible,
} from "./workflows";
import { AiGenerationKindSchema, AiProviderSchema } from "./schemas";

// Task #31: the kind→provider compatibility matrix (design-delta §7/§9-Q2), the single
// shared db-lib constant the API's POST /v1/ai/generations enforces (422) before any row
// or workflow is created.
//
// CORRECTED 2026-07-28 (genesis-1 Inspector, decision D1). The original comment here and
// design-delta §9-Q2 both said "Gloo has no media modalities". That is FALSE for images
// and TRUE for everything else, and both halves were measured against the live host:
//
//   - IMAGE: Gloo's catalogue carries 11 image-capable models (6 image-only, 5
//     text+image), and a real 1024x768 PNG was generated and decoded. They do NOT route
//     through chat/completions — that surface answers 400 with "Use the POST /v2/responses
//     endpoint instead" — which is why nothing here ever noticed.
//   - NARRATION / MUSIC / VIDEO: genuinely absent. Zero catalogue entries match
//     audio|speech|tts|voice|narrat|music|video, and the speech / transcription / video
//     routes all answer **404** (route absent), not 405 (route exists, wrong method).
//     Gloo's backend is FastAPI, so that distinction is trustworthy. openrouter-only is
//     therefore CORRECT for those three, and this matrix is not merely conservative.

describe("Task #31 AI provider compatibility matrix", () => {
  it("allows both providers for the two text kinds", () => {
    expect(AI_PROVIDERS_BY_KIND.storyboard).toEqual(["gloo", "openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.script).toEqual(["gloo", "openrouter"]);
  });

  it("U-MX1: image allows BOTH providers — Gloo really does generate images", () => {
    expect(AI_PROVIDERS_BY_KIND.image).toEqual(["gloo", "openrouter"]);
    expect(isProviderCompatible("image", "gloo")).toBe(true);
  });

  it("U-MX1b: narration/music/video stay openrouter-only — Gloo has no such models", () => {
    expect(AI_PROVIDERS_BY_KIND.narration).toEqual(["openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.music).toEqual(["openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.video).toEqual(["openrouter"]);
    for (const kind of ["narration", "music", "video"] as const) {
      expect(isProviderCompatible(kind, "gloo"), kind).toBe(false);
    }
  });

  it("covers every AiGenerationKind (complete record, unlike the partial workflow map)", () => {
    for (const kind of AiGenerationKindSchema.options) {
      expect(AI_PROVIDERS_BY_KIND[kind]).toBeDefined();
      expect(AI_PROVIDERS_BY_KIND[kind].length).toBeGreaterThan(0);
    }
  });

  it("isProviderCompatible is the full truth table", () => {
    // text kinds: both providers compatible.
    for (const kind of ["storyboard", "script"] as const) {
      expect(isProviderCompatible(kind, "gloo")).toBe(true);
      expect(isProviderCompatible(kind, "openrouter")).toBe(true);
    }
    // media kinds: openrouter always; gloo for image ONLY.
    for (const kind of ["image", "narration", "music", "video"] as const) {
      expect(isProviderCompatible(kind, "openrouter")).toBe(true);
    }
    expect(isProviderCompatible("image", "gloo")).toBe(true);
    for (const kind of ["narration", "music", "video"] as const) {
      expect(isProviderCompatible(kind, "gloo"), kind).toBe(false);
    }
  });

  it("only ever references real AiProvider values", () => {
    for (const kind of AiGenerationKindSchema.options) {
      for (const provider of AI_PROVIDERS_BY_KIND[kind]) {
        expect(AiProviderSchema.options).toContain(provider);
      }
    }
  });

  it("is re-exported from the package barrel", () => {
    expect(DbLib.AI_PROVIDERS_BY_KIND).toBe(AI_PROVIDERS_BY_KIND);
    expect(DbLib.isProviderCompatible("image", "gloo")).toBe(true);
    expect(DbLib.isProviderCompatible("narration", "gloo")).toBe(false);
    expect(DbLib.isProviderCompatible("script", "gloo")).toBe(true);
  });
});
