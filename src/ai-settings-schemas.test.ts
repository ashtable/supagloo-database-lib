import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

/**
 * Genesis-1 Inspector, decisions D-A/D-B — the project-level AI generation settings
 * that the studio Inspector writes into `supagloo.project.json`.
 *
 * Two things are being pinned here, and both are load-bearing for reasons that are NOT
 * obvious from the shape:
 *
 *  1. **`aiSettings` is OPTIONAL and `manifestVersion` stays `z.literal(1)`.** Every
 *     manifest already committed to a user's GitHub repo must keep parsing byte-for-byte
 *     unchanged. This is the repo's standing additive-optional convention, and the reason
 *     the round-trip test below asserts ABSENCE stays absence (a materialized `undefined`
 *     key breaks the nextjs adapter's serialize∘hydrate deep-equality contract).
 *
 *  2. **`FaithAlignmentSchema` is the ONLY thing standing between a typo and a silently
 *     wrong generation.** Gloo's `tradition` field is NOT validated server-side: the live
 *     probe (2026-07-28) sent `orthodox`, `protestant`, `reformed`, `pentecostal`,
 *     `buddhist`, `null` and a garbage sentinel, and every single one returned **200** and
 *     silently collapsed to the neutral 757-prompt-token baseline. There is no 422 to
 *     catch. So a wrong value is not an error the user sees — it is a video that quietly
 *     is not faith-aligned at all. The enum has to be enforced on OUR side.
 *
 *     In particular the user's own phrasing said "catholic/protestant/etc." — and
 *     `protestant` is not a Gloo value. `evangelical` and `mainline` are the two
 *     Protestant-family options. `orthodox` does not exist either.
 */

/** A minimal manifest that parses today, used as the base for every case below. */
const baseManifest = {
  manifestVersion: 1,
  composition: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  scenes: [
    {
      id: "s1",
      name: "wilderness · dawn",
      scriptText: "I am the voice of one",
      reference: "John 1:23",
      translation: "BSB",
      visualPrompt: "sweeping empty wilderness at first light",
      durationSeconds: 5,
      captions: true,
    },
  ],
  narratorVoice: { description: "warm, weathered baritone" },
};

// ---------------------------------------------------------------------------
// U-FA1 — the faith-alignment vocabulary
// ---------------------------------------------------------------------------

describe("Genesis-1 D-B — FaithAlignmentSchema (U-FA1)", () => {
  it("U-FA1a: accepts EXACTLY the four values Gloo's `tradition` field really honours", () => {
    // Measured 2026-07-28 by injected-system-prompt size on `POST /ai/v2/chat/completions`
    // (prompt "hi", max_tokens 1): omitted → 757 prompt tokens, not_faith_specific → 757,
    // catholic → 11253, evangelical → 11289, mainline → 11275.
    expect([...S.FaithAlignmentSchema.options].sort()).toEqual([
      "catholic",
      "evangelical",
      "mainline",
      "not_faith_specific",
    ]);
    for (const value of S.FaithAlignmentSchema.options) {
      expect(S.FaithAlignmentSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("U-FA1b: rejects `protestant` and `orthodox` — the two plausible values that DO NOT EXIST", () => {
    // Both return 200 from Gloo and silently degrade to neutral. If this schema ever
    // accepts them, the failure is invisible: the user picks "Protestant", the API says
    // OK, and the video is not faith-aligned.
    expect(S.FaithAlignmentSchema.safeParse("protestant").success).toBe(false);
    expect(S.FaithAlignmentSchema.safeParse("orthodox").success).toBe(false);
  });

  it("U-FA1c: rejects the other silently-accepted-by-Gloo values, empty string and null", () => {
    for (const bad of ["reformed", "pentecostal", "buddhist", "Catholic", "", null]) {
      expect(
        S.FaithAlignmentSchema.safeParse(bad).success,
        `${String(bad)} must be rejected`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// U-AS1..U-AS3 — the settings object on the manifest
// ---------------------------------------------------------------------------

describe("Genesis-1 D-A — AiGenerationSettingsSchema on the manifest (U-AS1..3)", () => {
  it("U-AS1: a manifest with NO aiSettings still parses, and absence stays absence", () => {
    const res = S.ProjectManifestSchema.safeParse(baseManifest);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) {
      expect("aiSettings" in res.data).toBe(false);
      // The version literal must NOT move: an already-committed v1 manifest is still v1.
      expect(res.data.manifestVersion).toBe(1);
    }
  });

  it("U-AS2: a manifest with a FULL aiSettings block round-trips through JSON unchanged", () => {
    const withSettings = {
      ...baseManifest,
      aiSettings: {
        faithAlignment: "catholic",
        image: { provider: "gloo", model: "some-vendor-image-model" },
        narration: { provider: "openrouter", model: "some-vendor/speech-model" },
        music: { provider: "openrouter", model: "some-vendor/music-model" },
        video: { provider: "openrouter", model: "some-vendor/video-model" },
      },
    };
    const res = S.ProjectManifestSchema.safeParse(withSettings);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(withSettings);
    // The manifest's file-format contract: it survives a serialize/parse round trip.
    expect(
      S.ProjectManifestSchema.safeParse(
        JSON.parse(JSON.stringify(withSettings)),
      ).success,
    ).toBe(true);
  });

  it("U-AS3: a per-kind choice may name a provider WITHOUT pinning a model", () => {
    // "Use Gloo, whatever model the system currently defaults to" is a legitimate and
    // in fact the DEFAULT user intent — item 1 says each selector defaults to what the
    // system uses today, which is resolved server-side, not written into the repo.
    const providerOnly = {
      ...baseManifest,
      aiSettings: { image: { provider: "gloo" } },
    };
    const res = S.ProjectManifestSchema.safeParse(providerOnly);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(providerOnly);
  });

  it("U-AS3b: a choice's provider must be a real AiProvider, and an empty model is rejected", () => {
    for (const bad of [
      { image: { provider: "anthropic" } },
      { image: { provider: "openrouter", model: "" } },
      { image: {} },
      { faithAlignment: "protestant" },
    ]) {
      expect(
        S.ProjectManifestSchema.safeParse({ ...baseManifest, aiSettings: bad })
          .success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("U-AS3c: the settings schema is exported from the package barrel", () => {
    expect(DbLib.FaithAlignmentSchema).toBe(S.FaithAlignmentSchema);
    expect(DbLib.AiGenerationSettingsSchema).toBe(S.AiGenerationSettingsSchema);
    expect(DbLib.AiModelChoiceSchema).toBe(S.AiModelChoiceSchema);
  });
});
