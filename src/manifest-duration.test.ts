import { describe, expect, it } from "vitest";
import { effectiveSceneDurationSeconds } from "./manifest-duration";
import type { ManifestScene } from "./schemas";

/**
 * The ONE rule that reconciles a scene's authored length with the measured length of
 * its own narration (plan D6). Bug 1's second half: the render must never cut a verse
 * off mid-sentence, so a scene is at least as long as the audio it has to carry.
 *
 * Deliberately a pure helper rather than a mutation of `durationSeconds`: overwriting
 * the authored value would clobber a duration the user explicitly edited and would make
 * the field non-idempotent across regenerations. The manifest records intent; this
 * derives the effect. Mirrored into supagloo-nextjs alongside the schemas it already
 * hand-mirrors, and applied at EVERY boundary that turns a scene into frames.
 */

const scene = (over: Partial<ManifestScene> = {}): ManifestScene => ({
  id: "s1",
  name: "Scene",
  scriptText: "In the beginning God created the heaven and the earth.",
  reference: "Genesis 1:1",
  translation: "KJV",
  visualPrompt: "a formless void",
  durationSeconds: 4,
  captions: true,
  ...over,
});

describe("effectiveSceneDurationSeconds", () => {
  it("U-D1: uses the authored duration when there is no measured narration", () => {
    expect(effectiveSceneDurationSeconds(scene({ durationSeconds: 4 }))).toBe(4);
  });

  it("U-D2: STRETCHES the scene when its narration is longer than the authored duration", () => {
    // The reported bug: the LLM suggested 4s, the verse takes 6.5s to read, and the
    // shipped render cut it off. The scene must grow, not the audio shrink.
    const s = scene({ durationSeconds: 4, narrationDurationSeconds: 6.5 });
    expect(effectiveSceneDurationSeconds(s)).toBe(6.5);
  });

  it("U-D3: keeps the authored duration when it already exceeds the narration", () => {
    const s = scene({ durationSeconds: 9, narrationDurationSeconds: 6.5 });
    expect(effectiveSceneDurationSeconds(s)).toBe(9);
  });

  it("U-D4: is unaffected by a null/absent narration key", () => {
    expect(
      effectiveSceneDurationSeconds(scene({ narrationAssetKey: null })),
    ).toBe(4);
  });
});
