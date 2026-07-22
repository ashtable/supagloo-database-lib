import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  AI_PROVIDERS_BY_KIND,
  isProviderCompatible,
} from "./workflows";
import { AiGenerationKindSchema, AiProviderSchema } from "./schemas";

// Task #31: the kind→provider compatibility matrix (design-delta §7/§9-Q2), the single
// shared db-lib constant the API's POST /v1/ai/generations enforces (422) before any row
// or workflow is created. Text kinds run on either provider; media kinds are openrouter
// only (Gloo has no media modalities).

describe("Task #31 AI provider compatibility matrix", () => {
  it("allows both providers for the two text kinds", () => {
    expect(AI_PROVIDERS_BY_KIND.storyboard).toEqual(["gloo", "openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.script).toEqual(["gloo", "openrouter"]);
  });

  it("restricts the four media kinds to openrouter only", () => {
    expect(AI_PROVIDERS_BY_KIND.image).toEqual(["openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.narration).toEqual(["openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.music).toEqual(["openrouter"]);
    expect(AI_PROVIDERS_BY_KIND.video).toEqual(["openrouter"]);
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
    // media kinds: openrouter yes, gloo no.
    for (const kind of ["image", "narration", "music", "video"] as const) {
      expect(isProviderCompatible(kind, "openrouter")).toBe(true);
      expect(isProviderCompatible(kind, "gloo")).toBe(false);
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
    expect(DbLib.isProviderCompatible("image", "gloo")).toBe(false);
    expect(DbLib.isProviderCompatible("script", "gloo")).toBe(true);
  });
});
