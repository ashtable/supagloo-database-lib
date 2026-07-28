import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Namespace import of the barrel so the live Prisma-generated enum consts are read
// as plain objects for the drift/consistency checks. Requires `prisma generate`
// first (pretest:unit hook).
import * as DbLib from "./index";
// The schemas under test. Until src/schemas.ts exists this import fails to resolve
// and the whole file errors — the intended clean RED.
import * as S from "./schemas";

// Unit tests for the Task #7 domain Zod schemas (design-delta §2.11). DB-free.
// They (a) prove each enum mirror's value set stays identical to the LIVE Prisma
// generated const (drift guard), (b) exercise accept/reject behavior of every
// schema, (c) prove the manifest survives a JSON serialize/deserialize round-trip
// (its file-format contract), and (d) run a `tsc --noEmit` type-level check.
// Real JSON-column persistence is proven in tests/e2e/domain-schemas.e2e.ts.

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/** Sorted string values of a Prisma generated enum const. */
function vals(e: unknown): string[] {
  return Object.values((e ?? {}) as Record<string, string>).sort();
}

/** Sorted literal options of a Zod enum schema. */
function opts(schema: { options: readonly string[] }): string[] {
  return [...schema.options].sort();
}

// ---------------------------------------------------------------------------
// A. Enum mirrors + Translation
// ---------------------------------------------------------------------------

// [Zod mirror schema, live Prisma generated const, human name]
const ENUM_PAIRS: Array<[{ options: readonly string[] }, unknown, string]> = [
  [S.RepoVisibilitySchema, DbLib.RepoVisibility, "RepoVisibility"],
  [S.ProjectCreatedFromSchema, DbLib.ProjectCreatedFrom, "ProjectCreatedFrom"],
  [S.ProjectVersionStateSchema, DbLib.ProjectVersionState, "ProjectVersionState"],
  [S.RenderStatusSchema, DbLib.RenderStatus, "RenderStatus"],
  [S.GalleryVisibilitySchema, DbLib.GalleryVisibility, "GalleryVisibility"],
  [S.AiGenerationKindSchema, DbLib.AiGenerationKind, "AiGenerationKind"],
  [S.AiProviderSchema, DbLib.AiProvider, "AiProvider"],
  [S.ProjectJobKindSchema, DbLib.ProjectJobKind, "ProjectJobKind"],
  [S.JobStatusSchema, DbLib.JobStatus, "JobStatus"],
];

describe("Task #7 schemas — enum mirror consistency (vs live Prisma const)", () => {
  it("mirrors all nine Prisma enums with identical value sets", () => {
    for (const [schema, prismaConst, name] of ENUM_PAIRS) {
      expect(opts(schema), `${name} value set`).toEqual(vals(prismaConst));
    }
  });

  it("each mirror parses every live Prisma member and rejects a foreigner", () => {
    for (const [schema, prismaConst, name] of ENUM_PAIRS) {
      const s = schema as unknown as {
        safeParse: (v: unknown) => { success: boolean };
      };
      for (const member of vals(prismaConst)) {
        expect(s.safeParse(member).success, `${name} accepts ${member}`).toBe(true);
      }
      expect(s.safeParse("__nope__").success, `${name} rejects foreigner`).toBe(
        false,
      );
    }
  });
});

describe("Task #7/#30 schemas — TranslationSchema (any licensed translation, §9-Q10)", () => {
  // §9-Q10 (2026-07-18) SUPERSEDED the KJV/BSB-only enum: generation sources ANY
  // translation YouVersion licenses to the app for the user's language. The *licensed set*
  // is validated at runtime against the live "Get a Bible collection" call (task #30's
  // fetchScripturePassage), NOT by this schema — so the schema is a non-empty string, not a
  // fixed enum. KJV/BSB stay the pre-selected default; they are no longer the only members.
  it("accepts any non-empty translation abbreviation", () => {
    for (const ok of ["KJV", "BSB", "NIV", "ESV", "NLT", "NASB"]) {
      expect(S.TranslationSchema.safeParse(ok).success, `accepts ${ok}`).toBe(true);
    }
  });
  it("rejects an empty translation", () => {
    expect(S.TranslationSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validManifest = {
  manifestVersion: 1,
  composition: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
  narratorVoice: {
    description:
      "warm, weathered, resonant baritone — unhurried, reverent, like James Earl Jones narrating scripture",
    label: "JAMES EARL JONES-STYLE",
  },
  music: { style: "Swelling strings", assetKey: "projects/x/music/bed.mp3" },
  endCard: { headline: "JOHN 1:23 · KJV", subtext: "Made with Supagloo" },
  scenes: [
    {
      id: "s1",
      name: "wilderness · dawn",
      scriptText: "I am the voice of one",
      reference: "JOHN 1:23",
      translation: "KJV",
      visualPrompt:
        "sweeping empty wilderness at first light, pale dawn breaking over dunes, cinematic wide establishing shot",
      durationSeconds: 5,
      captions: true,
      visualAssetKey: "projects/x/scenes/s1.png",
    },
    {
      id: "s2",
      name: "lone figure · desert path",
      scriptText: "of one crying in the wilderness,",
      reference: "JOHN 1:23",
      translation: "KJV",
      visualPrompt:
        "lone bearded figure walking a desert path, blowing dust, low golden sun, cinematic 35mm",
      durationSeconds: 9,
      captions: true,
      visualAssetKey: null,
    },
  ],
};

const validStoryboard = {
  scenes: [
    {
      name: "wilderness · dawn",
      scriptText: "I am the voice of one",
      reference: "JOHN 1:23",
      translation: "KJV",
      visualPrompt:
        "sweeping empty wilderness at first light, pale dawn breaking over dunes",
      suggestedDurationSeconds: 5,
    },
    {
      name: "verse card",
      scriptText: "John 1:23 · KJV",
      reference: "JOHN 1:23",
      translation: "BSB",
      visualPrompt: "elegant scripture verse card, dark parchment, warm serif type",
      suggestedDurationSeconds: 8,
    },
  ],
  narratorVoice: {
    description: "warm, weathered baritone, unhurried and reverent",
    label: "JAMES EARL JONES-STYLE",
  },
  musicStyle: "Swelling strings",
};

const validNarrationSpec = {
  voice: { description: "warm, weathered baritone", label: "JEJ-STYLE" },
  scenes: [
    { sceneId: "s1", scriptText: "I am the voice of one" },
    { sceneId: "s2", scriptText: "of one crying in the wilderness," },
  ],
};

const validMusicSpec = { style: "Swelling strings", durationSeconds: 30 };

const validRenderSpec = {
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  fps: 30,
  codec: "h264",
};

// ---------------------------------------------------------------------------
// B. ProjectManifestSchema
// ---------------------------------------------------------------------------

describe("Task #7 schemas — ProjectManifestSchema", () => {
  it("parses a fully-valid manifest and preserves the data", () => {
    const res = S.ProjectManifestSchema.safeParse(validManifest);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(validManifest);
  });

  it("rejects a manifestVersion other than the literal 1", () => {
    expect(
      S.ProjectManifestSchema.safeParse({ ...validManifest, manifestVersion: 2 })
        .success,
    ).toBe(false);
  });

  it("accepts a scene translation beyond KJV/BSB (§9-Q10 broadening) but rejects an empty one", () => {
    const niv = {
      ...validManifest,
      scenes: [{ ...validManifest.scenes[0], translation: "NIV" }],
    };
    expect(S.ProjectManifestSchema.safeParse(niv).success).toBe(true);
    const empty = {
      ...validManifest,
      scenes: [{ ...validManifest.scenes[0], translation: "" }],
    };
    expect(S.ProjectManifestSchema.safeParse(empty).success).toBe(false);
  });

  it("rejects a scene missing visualPrompt or with a non-positive duration", () => {
    const { visualPrompt: _drop, ...noPrompt } = validManifest.scenes[0];
    expect(
      S.ProjectManifestSchema.safeParse({ ...validManifest, scenes: [noPrompt] })
        .success,
    ).toBe(false);
    expect(
      S.ProjectManifestSchema.safeParse({
        ...validManifest,
        scenes: [{ ...validManifest.scenes[0], durationSeconds: -1 }],
      }).success,
    ).toBe(false);
  });

  it("rejects a bad composition (zero width, malformed aspectRatio)", () => {
    expect(
      S.ProjectManifestSchema.safeParse({
        ...validManifest,
        composition: { ...validManifest.composition, width: 0 },
      }).success,
    ).toBe(false);
    expect(
      S.ProjectManifestSchema.safeParse({
        ...validManifest,
        composition: { ...validManifest.composition, aspectRatio: "16x9" },
      }).success,
    ).toBe(false);
  });

  it("round-trips through JSON.stringify/parse (supagloo.project.json format)", () => {
    const roundTripped = JSON.parse(JSON.stringify(validManifest));
    const res = S.ProjectManifestSchema.safeParse(roundTripped);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(validManifest);
  });

  it("accepts an absent music/endCard, an omitted visualAssetKey, and empty scenes", () => {
    const minimal = {
      manifestVersion: 1,
      composition: validManifest.composition,
      narratorVoice: validManifest.narratorVoice,
      scenes: [
        {
          id: "s1",
          name: "scene",
          scriptText: "text",
          reference: "JOHN 1:23",
          translation: "KJV",
          visualPrompt: "a prompt",
          durationSeconds: 3,
          captions: false,
          // visualAssetKey omitted
        },
      ],
    };
    expect(S.ProjectManifestSchema.safeParse(minimal).success).toBe(true);
    expect(
      S.ProjectManifestSchema.safeParse({ ...minimal, scenes: [] }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B2. VoiceDescriptorSchema.assetKey (Task #35 — whole-project narration asset)
// ---------------------------------------------------------------------------

describe("Task #35 schema — VoiceDescriptorSchema.assetKey", () => {
  it("accepts the whole-project narration assetKey (string, null, or omitted)", () => {
    expect(
      S.VoiceDescriptorSchema.safeParse({ description: "warm baritone" }).success,
    ).toBe(true);
    expect(
      S.VoiceDescriptorSchema.safeParse({
        description: "warm baritone",
        label: "JEJ",
      }).success,
    ).toBe(true);
    expect(
      S.VoiceDescriptorSchema.safeParse({
        description: "warm baritone",
        label: "JEJ",
        assetKey: "projects/x/narration/track.mp3",
      }).success,
    ).toBe(true);
    expect(
      S.VoiceDescriptorSchema.safeParse({
        description: "warm baritone",
        assetKey: null,
      }).success,
    ).toBe(true);
  });

  it("rejects an empty-string assetKey (mirrors MusicBed.assetKey min(1))", () => {
    expect(
      S.VoiceDescriptorSchema.safeParse({
        description: "warm baritone",
        assetKey: "",
      }).success,
    ).toBe(false);
  });

  it("round-trips a manifest whose narratorVoice carries an assetKey", () => {
    const withNarration = {
      ...validManifest,
      narratorVoice: {
        ...validManifest.narratorVoice,
        assetKey: "projects/x/narration/track.mp3",
      },
    };
    const res = S.ProjectManifestSchema.safeParse(withNarration);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(withNarration);
  });
});

// ---------------------------------------------------------------------------
// B3. Render-bug fields: per-scene narration, the still/clip discriminator, and the
//     MEASURED music length (plan D5). Every one is OPTIONAL — genesis-1's committed
//     manifest is already `manifestVersion: 1` and must keep parsing untouched.
// ---------------------------------------------------------------------------

describe("Render-bug schemas — per-scene narration + visualAssetKind + measured music length", () => {
  it("U-RB1: a v1 scene WITHOUT any of the new fields still parses (backward compatibility)", () => {
    const res = S.ProjectManifestSchema.safeParse(validManifest);
    expect(res.success, JSON.stringify(res)).toBe(true);
    // Absence must stay absence — a materialized `undefined` key would break the nextjs
    // adapter's serialize∘hydrate deep-equality contract (U-A5).
    if (res.success) {
      expect("narrationAssetKey" in res.data.scenes[0]).toBe(false);
      expect("visualAssetKind" in res.data.scenes[0]).toBe(false);
    }
  });

  it("U-RB2: a scene accepts narrationAssetKey + narrationDurationSeconds and round-trips them", () => {
    const withNarration = {
      ...validManifest,
      scenes: [
        {
          ...validManifest.scenes[0],
          narrationAssetKey: "projects/x/assets/gen-1/scene-s1.mp3",
          narrationDurationSeconds: 3.528,
        },
      ],
    };
    const res = S.ProjectManifestSchema.safeParse(withNarration);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(withNarration);
  });

  it("U-RB3: narrationAssetKey accepts null but rejects the empty string", () => {
    const nulled = {
      ...validManifest,
      scenes: [{ ...validManifest.scenes[0], narrationAssetKey: null }],
    };
    expect(S.ProjectManifestSchema.safeParse(nulled).success).toBe(true);
    const empty = {
      ...validManifest,
      scenes: [{ ...validManifest.scenes[0], narrationAssetKey: "" }],
    };
    expect(S.ProjectManifestSchema.safeParse(empty).success).toBe(false);
  });

  it("U-RB4: narrationDurationSeconds must be positive", () => {
    for (const bad of [0, -1]) {
      const m = {
        ...validManifest,
        scenes: [{ ...validManifest.scenes[0], narrationDurationSeconds: bad }],
      };
      expect(S.ProjectManifestSchema.safeParse(m).success, `duration ${bad}`).toBe(
        false,
      );
    }
  });

  it("U-RB5: visualAssetKind accepts image/video and rejects anything else", () => {
    // The discriminator that lets Ken Burns apply to STILLS only — and that closes the
    // latent bug where a video-kind asset was rendered through <Img>.
    for (const kind of ["image", "video"]) {
      const m = {
        ...validManifest,
        scenes: [{ ...validManifest.scenes[0], visualAssetKind: kind }],
      };
      expect(S.ProjectManifestSchema.safeParse(m).success, kind).toBe(true);
    }
    const bogus = {
      ...validManifest,
      scenes: [{ ...validManifest.scenes[0], visualAssetKind: "gif" }],
    };
    expect(S.ProjectManifestSchema.safeParse(bogus).success).toBe(false);
  });

  it("U-RB6: MusicBedSchema carries the MEASURED durationSeconds, positive-only, optional", () => {
    expect(
      S.MusicBedSchema.safeParse({ style: "ambient pads" }).success,
      "still optional",
    ).toBe(true);
    expect(
      S.MusicBedSchema.safeParse({
        style: "ambient pads",
        assetKey: "projects/x/music.mp3",
        durationSeconds: 29.074,
      }).success,
    ).toBe(true);
    expect(
      S.MusicBedSchema.safeParse({ style: "ambient pads", durationSeconds: 0 })
        .success,
    ).toBe(false);
  });

  it("U-RB7: NarrationResultSchema round-trips the per-scene map an AiGeneration keeps in resultJson", () => {
    // Plan D4: one generation row keeps ONE resultAssetKey; the N per-scene assets are
    // carried in resultJson, which is what makes scene-synced narration expressible
    // without N generation rows.
    const result = {
      scenes: [
        {
          sceneId: "s1",
          assetKey: "projects/p/assets/g1/scene-s1.mp3",
          durationSeconds: 3.528,
        },
        {
          sceneId: "s2",
          assetKey: "projects/p/assets/g1/scene-s2.mp3",
          durationSeconds: 5.04,
        },
      ],
    };
    const res = S.NarrationResultSchema.safeParse(result);
    expect(res.success, JSON.stringify(res)).toBe(true);
    if (res.success) expect(res.data).toEqual(result);
    // An entry whose duration could not be measured is still ACCEPTED: the clip can still
    // be mounted inside its own scene's <Sequence> (most of the fix), and only the
    // stretch-to-fit is lost. Recording a fabricated length instead would silently mis-time
    // the scene, which is worse than an absent one. It mirrors
    // `ManifestScene.narrationDurationSeconds`, which is optional for the same reason.
    expect(
      S.NarrationResultSchema.safeParse({
        scenes: [{ sceneId: "s1", assetKey: "k" }],
      }).success,
    ).toBe(true);
    // A duration that IS present must still be a real one.
    expect(
      S.NarrationResultSchema.safeParse({
        scenes: [{ sceneId: "s1", assetKey: "k", durationSeconds: 0 }],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. GeneratedStoryboardSchema
// ---------------------------------------------------------------------------

describe("Task #7 schemas — GeneratedStoryboardSchema (LLM structured output)", () => {
  it("parses a valid storyboard", () => {
    const res = S.GeneratedStoryboardSchema.safeParse(validStoryboard);
    expect(res.success, JSON.stringify(res)).toBe(true);
  });

  it("requires at least one scene", () => {
    expect(
      S.GeneratedStoryboardSchema.safeParse({ ...validStoryboard, scenes: [] })
        .success,
    ).toBe(false);
  });

  it("rejects a scene missing suggestedDurationSeconds or with an empty translation", () => {
    const { suggestedDurationSeconds: _d, ...noDur } = validStoryboard.scenes[0];
    expect(
      S.GeneratedStoryboardSchema.safeParse({
        ...validStoryboard,
        scenes: [noDur],
      }).success,
    ).toBe(false);
    expect(
      S.GeneratedStoryboardSchema.safeParse({
        ...validStoryboard,
        scenes: [{ ...validStoryboard.scenes[0], translation: "" }],
      }).success,
    ).toBe(false);
  });

  it("accepts a non-KJV/BSB scene translation (§9-Q10 broadening)", () => {
    expect(
      S.GeneratedStoryboardSchema.safeParse({
        ...validStoryboard,
        scenes: [{ ...validStoryboard.scenes[0], translation: "NIV" }],
      }).success,
    ).toBe(true);
  });

  it("requires whole-video narratorVoice and musicStyle", () => {
    const { narratorVoice: _v, ...noVoice } = validStoryboard;
    const { musicStyle: _m, ...noMusic } = validStoryboard;
    expect(S.GeneratedStoryboardSchema.safeParse(noVoice).success).toBe(false);
    expect(S.GeneratedStoryboardSchema.safeParse(noMusic).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D–G. The remaining specs
// ---------------------------------------------------------------------------

describe("Task #7 schemas — SceneVisualPromptSchema (reroll output)", () => {
  it("parses a single refined prompt", () => {
    expect(
      S.SceneVisualPromptSchema.safeParse({ visualPrompt: "a refined prompt" })
        .success,
    ).toBe(true);
  });
  it("rejects an empty or missing prompt", () => {
    expect(S.SceneVisualPromptSchema.safeParse({}).success).toBe(false);
    expect(S.SceneVisualPromptSchema.safeParse({ visualPrompt: "" }).success).toBe(
      false,
    );
  });
});

describe("Task #7 schemas — NarrationSpecSchema (audio synth input)", () => {
  it("parses a valid narration spec", () => {
    expect(S.NarrationSpecSchema.safeParse(validNarrationSpec).success).toBe(true);
  });
  it("rejects a missing voice, empty script, or empty scene list", () => {
    const { voice: _v, ...noVoice } = validNarrationSpec;
    expect(S.NarrationSpecSchema.safeParse(noVoice).success).toBe(false);
    expect(
      S.NarrationSpecSchema.safeParse({
        ...validNarrationSpec,
        scenes: [{ sceneId: "s1", scriptText: "" }],
      }).success,
    ).toBe(false);
    expect(
      S.NarrationSpecSchema.safeParse({ ...validNarrationSpec, scenes: [] }).success,
    ).toBe(false);
  });
});

describe("Task #7 schemas — MusicSpecSchema (audio synth input)", () => {
  it("parses a style + duration", () => {
    expect(S.MusicSpecSchema.safeParse(validMusicSpec).success).toBe(true);
  });
  it("rejects a non-positive duration or a missing style", () => {
    expect(
      S.MusicSpecSchema.safeParse({ ...validMusicSpec, durationSeconds: 0 }).success,
    ).toBe(false);
    const { style: _s, ...noStyle } = validMusicSpec;
    expect(S.MusicSpecSchema.safeParse(noStyle).success).toBe(false);
  });
});

describe("Task #7 schemas — RenderOutputSpecSchema (CompositionSpec + codec)", () => {
  it("parses width/height/aspectRatio/fps/codec", () => {
    expect(S.RenderOutputSpecSchema.safeParse(validRenderSpec).success).toBe(true);
  });
  it("rejects a malformed aspectRatio, a non-integer fps, and a missing codec", () => {
    expect(
      S.RenderOutputSpecSchema.safeParse({ ...validRenderSpec, aspectRatio: "9-16" })
        .success,
    ).toBe(false);
    expect(
      S.RenderOutputSpecSchema.safeParse({ ...validRenderSpec, fps: 29.97 }).success,
    ).toBe(false);
    const { codec: _c, ...noCodec } = validRenderSpec;
    expect(S.RenderOutputSpecSchema.safeParse(noCodec).success).toBe(false);
  });
});

describe("Task #36 schemas — RenderWorkflowPayloadSchema (the render enqueue contract)", () => {
  it("parses the { renderJobId } echo payload", () => {
    expect(
      S.RenderWorkflowPayloadSchema.safeParse({ renderJobId: "rj_123" }).success,
    ).toBe(true);
  });

  it("rejects a missing, empty, or non-string renderJobId", () => {
    expect(S.RenderWorkflowPayloadSchema.safeParse({}).success).toBe(false);
    expect(
      S.RenderWorkflowPayloadSchema.safeParse({ renderJobId: "" }).success,
    ).toBe(false);
    expect(
      S.RenderWorkflowPayloadSchema.safeParse({ renderJobId: 7 }).success,
    ).toBe(false);
  });

  it("mirrors the other workflows' single-id echo convention (everything else is read off the row)", () => {
    const parsed = S.RenderWorkflowPayloadSchema.parse({ renderJobId: "rj_123" });
    expect(Object.keys(parsed)).toEqual(["renderJobId"]);
  });
});

// ---------------------------------------------------------------------------
// G2. Task #37 — render WIRE DTOs (design-delta §2.7/§2.11/§6c/§8)
// ---------------------------------------------------------------------------

const validRenderJobDto = {
  id: "rj_1",
  projectId: "prj_1",
  versionId: "pv_1",
  status: "encoding",
  framesDone: 612,
  framesTotal: 840,
  outputSpec: validRenderSpec,
  outputAssetKey: null,
  thumbnailAssetKey: null,
  runInBackground: false,
  error: null,
  createdAt: "2026-07-24T10:00:00.000Z",
  startedAt: "2026-07-24T10:00:01.000Z",
  completedAt: null,
};

describe("Task #37 schemas — CreateRenderRequestSchema", () => {
  it("parses { versionId, outputSpec, runInBackground }", () => {
    const parsed = S.CreateRenderRequestSchema.parse({
      versionId: "pv_1",
      outputSpec: validRenderSpec,
      runInBackground: true,
    });
    expect(parsed.versionId).toBe("pv_1");
    expect(parsed.outputSpec).toEqual(validRenderSpec);
    expect(parsed.runInBackground).toBe(true);
  });

  it("defaults runInBackground to false when omitted (the column is non-nullable)", () => {
    const parsed = S.CreateRenderRequestSchema.parse({
      versionId: "pv_1",
      outputSpec: validRenderSpec,
    });
    expect(parsed.runInBackground).toBe(false);
  });

  it("rejects a missing/empty versionId", () => {
    expect(
      S.CreateRenderRequestSchema.safeParse({ outputSpec: validRenderSpec }).success,
    ).toBe(false);
    expect(
      S.CreateRenderRequestSchema.safeParse({
        versionId: "",
        outputSpec: validRenderSpec,
      }).success,
    ).toBe(false);
  });

  it("delegates spec validation to RenderOutputSpecSchema (bad aspect / non-int fps / no codec)", () => {
    const bad = (outputSpec: unknown) =>
      S.CreateRenderRequestSchema.safeParse({ versionId: "pv_1", outputSpec })
        .success;
    expect(bad({ ...validRenderSpec, aspectRatio: "9-16" })).toBe(false);
    expect(bad({ ...validRenderSpec, fps: 29.97 })).toBe(false);
    const { codec: _c, ...noCodec } = validRenderSpec;
    expect(bad(noCodec)).toBe(false);
    expect(bad(undefined)).toBe(false);
  });
});

describe("Task #37 schemas — render response DTOs", () => {
  it("CreateRenderResponseSchema returns ids only (the create-response convention)", () => {
    const parsed = S.CreateRenderResponseSchema.parse({ renderJobId: "rj_1" });
    expect(Object.keys(parsed)).toEqual(["renderJobId"]);
  });

  it("RenderJobDtoSchema parses a full row projection with the spec re-nested", () => {
    const parsed = S.RenderJobDtoSchema.parse(validRenderJobDto);
    expect(parsed.outputSpec).toEqual(validRenderSpec);
    expect(parsed.status).toBe("encoding");
    expect(parsed.completedAt).toBeNull();
  });

  it("RenderJobDtoSchema omits userId (the caller is the owner — connection-DTO precedent)", () => {
    const parsed = S.RenderJobDtoSchema.parse({
      ...validRenderJobDto,
      userId: "usr_leak",
    }) as Record<string, unknown>;
    expect("userId" in parsed).toBe(false);
  });

  it("RenderJobDtoSchema rejects an unknown status and a non-integer frame count", () => {
    expect(
      S.RenderJobDtoSchema.safeParse({ ...validRenderJobDto, status: "rendering" })
        .success,
    ).toBe(false);
    expect(
      S.RenderJobDtoSchema.safeParse({ ...validRenderJobDto, framesDone: 1.5 })
        .success,
    ).toBe(false);
  });

  it("single + list responses are KEYED envelopes, never bare rows/arrays", () => {
    expect(
      S.RenderJobResponseSchema.safeParse({ render: validRenderJobDto }).success,
    ).toBe(true);
    expect(S.RenderJobResponseSchema.safeParse(validRenderJobDto).success).toBe(
      false,
    );
    expect(
      S.RenderJobListResponseSchema.safeParse({ renders: [validRenderJobDto] })
        .success,
    ).toBe(true);
    expect(S.RenderJobListResponseSchema.safeParse([validRenderJobDto]).success).toBe(
      false,
    );
  });
});

describe("Task #37 schemas — RenderIdParamSchema / RenderListQuerySchema", () => {
  it("RenderIdParamSchema requires a non-empty id", () => {
    expect(S.RenderIdParamSchema.safeParse({ id: "rj_1" }).success).toBe(true);
    expect(S.RenderIdParamSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("RenderListQuerySchema requires the literal mine=1 (there is no cross-user listing)", () => {
    expect(S.RenderListQuerySchema.safeParse({ mine: "1" }).success).toBe(true);
    expect(S.RenderListQuerySchema.safeParse({}).success).toBe(false);
    expect(S.RenderListQuerySchema.safeParse({ mine: "0" }).success).toBe(false);
    expect(S.RenderListQuerySchema.safeParse({ mine: "true" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G3. Tasks #39/#40 — gallery WIRE DTOs (design-delta §2.7/§6c/§8, plan D6/D11/D12)
// ---------------------------------------------------------------------------

const validGalleryItemDto = {
  id: "gi_1",
  renderJobId: "rj_1",
  projectId: "prj_1",
  title: "In the beginning",
  description: "A four-scene reading of the creation account.",
  scriptureReference: "GENESIS 1:1-4",
  scriptureBook: "GEN",
  translation: "KJV",
  durationSeconds: 42,
  visibility: "public",
  publishedAt: "2026-07-25T10:00:00.000Z",
  upvoteCount: 7,
  thumbnailUrl: "https://s3.example.test/renders/rj_1/thumb.jpg?X-Amz-Signature=…",
  rank: 1,
  viewerHasUpvoted: false,
  owner: { displayName: "Mary K", avatarInitials: "MK" },
};

describe("Tasks #39/#40 schemas — GallerySortSchema (U-GS1)", () => {
  it("is the closed three-value sort enum", () => {
    expect(opts(S.GallerySortSchema)).toEqual(
      ["popular", "newest", "trending"].sort(),
    );
  });

  it("rejects any other sort key", () => {
    for (const bad of ["hot", "top", "POPULAR", ""]) {
      expect(S.GallerySortSchema.safeParse(bad).success, `rejects ${bad}`).toBe(
        false,
      );
    }
  });
});

describe("Tasks #39/#40 schemas — GalleryListQuerySchema (U-GS1)", () => {
  it("defaults sort to `popular` (the design's default listing order)", () => {
    const parsed = S.GalleryListQuerySchema.parse({});
    expect(parsed.sort).toBe("popular");
    expect(parsed.q).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it("accepts each sort and the q/cursor params — and NOTHING else", () => {
    for (const sort of ["popular", "newest", "trending"] as const) {
      expect(S.GalleryListQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    const parsed = S.GalleryListQuerySchema.parse({
      sort: "newest",
      q: "creation",
      cursor: "eyJzIjoibmV3ZXN0In0",
    });
    // Exhaustive on purpose: the query surface is exactly these three keys.
    expect(parsed).toEqual({
      sort: "newest",
      q: "creation",
      cursor: "eyJzIjoibmV3ZXN0In0",
    });
  });

  it("rejects an unknown sort (`sort=hot` is a 400 at the Zod boundary)", () => {
    expect(S.GalleryListQuerySchema.safeParse({ sort: "hot" }).success).toBe(false);
  });

  it("declares NO client `limit` (page size is server-owned — an unbounded public limit is a DoS)", () => {
    const parsed = S.GalleryListQuerySchema.parse({ limit: "1000" }) as Record<
      string,
      unknown
    >;
    expect("limit" in parsed).toBe(false);
  });

  it("declares NO `book` filter (the gallery is not filterable by book — book membership is a property of the TRANSLATION, YouVersion's authority, not ours)", () => {
    const parsed = S.GalleryListQuerySchema.parse({
      sort: "newest",
      book: "GEN",
    }) as Record<string, unknown>;
    expect("book" in parsed).toBe(false);
    expect(parsed).toEqual({ sort: "newest" });
  });

  it("accepts an EMPTY `q` (the service treats blank as absent, never as a `%%` match)", () => {
    expect(S.GalleryListQuerySchema.parse({ q: "" }).q).toBe("");
    expect(S.GalleryListQuerySchema.parse({ q: "   " }).q).toBe("   ");
  });
});

describe("Tasks #39/#40 schemas — PublishGalleryItemRequestSchema (U-GS2)", () => {
  const minimal = {
    title: "In the beginning",
    scriptureReference: "GENESIS 1:1-4",
    translation: "KJV",
  };

  it("defaults description to \"\" and visibility to `public`", () => {
    const parsed = S.PublishGalleryItemRequestSchema.parse(minimal);
    expect(parsed.description).toBe("");
    expect(parsed.visibility).toBe("public");
  });

  it("accepts an explicit unlisted visibility and a long description", () => {
    const parsed = S.PublishGalleryItemRequestSchema.parse({
      ...minimal,
      description: "x".repeat(1000),
      visibility: "unlisted",
    });
    expect(parsed.visibility).toBe("unlisted");
    expect(parsed.description).toHaveLength(1000);
  });

  it("rejects an empty/missing title and an over-long one", () => {
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({ ...minimal, title: "" }).success,
    ).toBe(false);
    const { title: _t, ...noTitle } = minimal;
    expect(S.PublishGalleryItemRequestSchema.safeParse(noTitle).success).toBe(false);
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({
        ...minimal,
        title: "x".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("TRIMS title + scriptureReference, so a whitespace-only value is a 400 not an invisible card title", () => {
    const parsed = S.PublishGalleryItemRequestSchema.parse({
      ...minimal,
      title: "  In the beginning  ",
      scriptureReference: "  GENESIS 1:1-4  ",
    });
    expect(parsed.title).toBe("In the beginning");
    expect(parsed.scriptureReference).toBe("GENESIS 1:1-4");
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({ ...minimal, title: "   " }).success,
    ).toBe(false);
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({
        ...minimal,
        scriptureReference: "\t\n ",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty/missing scriptureReference (the 422 deriver needs something to read)", () => {
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({
        ...minimal,
        scriptureReference: "",
      }).success,
    ).toBe(false);
    const { scriptureReference: _r, ...noRef } = minimal;
    expect(S.PublishGalleryItemRequestSchema.safeParse(noRef).success).toBe(false);
  });

  it("bounds title AND scriptureReference at exactly 120 characters (both boundaries)", () => {
    // The upper bound matters on scriptureReference specifically: it is rendered
    // VERBATIM on a public card and it is the string echoed back in the 422 message, so
    // an unbounded value is both a layout break and an error-message payload. Asserted
    // at 120/121 rather than "some long string", so widening the cap fails here.
    const ok = (patch: Record<string, unknown>) =>
      S.PublishGalleryItemRequestSchema.safeParse({ ...minimal, ...patch }).success;
    expect(ok({ scriptureReference: "G".repeat(120) })).toBe(true);
    expect(ok({ scriptureReference: "G".repeat(121) })).toBe(false);
    expect(ok({ title: "T".repeat(120) })).toBe(true);
    expect(ok({ title: "T".repeat(121) })).toBe(false);
    expect(ok({ description: "D".repeat(1000) })).toBe(true);
    expect(ok({ description: "D".repeat(1001) })).toBe(false);
  });

  it("rejects an empty translation (delegates to TranslationSchema) and an over-long description", () => {
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({ ...minimal, translation: "" })
        .success,
    ).toBe(false);
    expect(
      S.PublishGalleryItemRequestSchema.safeParse({
        ...minimal,
        description: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });

  it("carries NO asset keys and NO scriptureBook (both are server-derived, never client-supplied)", () => {
    const parsed = S.PublishGalleryItemRequestSchema.parse({
      ...minimal,
      videoAssetKey: "renders/evil/output.mp4",
      thumbnailAssetKey: "renders/evil/thumb.jpg",
      scriptureBook: "REV",
      durationSeconds: 99999,
    }) as Record<string, unknown>;
    expect("videoAssetKey" in parsed).toBe(false);
    expect("thumbnailAssetKey" in parsed).toBe(false);
    expect("scriptureBook" in parsed).toBe(false);
    expect("durationSeconds" in parsed).toBe(false);
  });
});

describe("Tasks #39/#40 schemas — GalleryItemDtoSchema (U-GS4)", () => {
  it("parses a full listing row projection", () => {
    const parsed = S.GalleryItemDtoSchema.parse(validGalleryItemDto);
    expect(parsed.scriptureBook).toBe("GEN");
    expect(parsed.owner.avatarInitials).toBe("MK");
    expect(parsed.rank).toBe(1);
  });

  it("accepts rank: null (non-null ONLY under sort=popular) and thumbnailUrl: null", () => {
    const parsed = S.GalleryItemDtoSchema.parse({
      ...validGalleryItemDto,
      rank: null,
      thumbnailUrl: null,
    });
    expect(parsed.rank).toBeNull();
    expect(parsed.thumbnailUrl).toBeNull();
  });

  it("requires the owner projection (displayName + avatarInitials)", () => {
    const { owner: _o, ...noOwner } = validGalleryItemDto;
    expect(S.GalleryItemDtoSchema.safeParse(noOwner).success).toBe(false);
    expect(
      S.GalleryItemDtoSchema.safeParse({
        ...validGalleryItemDto,
        owner: { displayName: "Mary K" },
      }).success,
    ).toBe(false);
  });

  it("omits videoAssetKey, ownerId and viewCount (public consumers go through stream-url)", () => {
    const parsed = S.GalleryItemDtoSchema.parse({
      ...validGalleryItemDto,
      videoAssetKey: "renders/rj_1/output.mp4",
      ownerId: "usr_leak",
      viewCount: 0,
    }) as Record<string, unknown>;
    expect("videoAssetKey" in parsed).toBe(false);
    expect("ownerId" in parsed).toBe(false);
    expect("viewCount" in parsed).toBe(false);
  });

  it("rejects an unknown visibility, a non-integer duration and a non-integer rank", () => {
    const bad = (patch: Record<string, unknown>) =>
      S.GalleryItemDtoSchema.safeParse({ ...validGalleryItemDto, ...patch }).success;
    expect(bad({ visibility: "private" })).toBe(false);
    expect(bad({ durationSeconds: 1.5 })).toBe(false);
    expect(bad({ rank: 1.5 })).toBe(false);
    expect(bad({ upvoteCount: "7" })).toBe(false);
    expect(bad({ viewerHasUpvoted: "false" })).toBe(false);
  });

  // REQUIRED-NESS, key by key. The failure this guards is concrete and cheap to ship: a
  // handler whose Prisma `select` forgets `scriptureBook` or `publishedAt` returns an
  // object MISSING that key, and if the field were `.optional()` the DTO would accept it
  // and the card would render `undefined`. Only `rank` and `thumbnailUrl` are nullable,
  // and both are nullable-NOT-optional, so the handler is still forced to decide (a null
  // rank means "not the popular sort"; a null thumbnailUrl means "could not be signed").
  // A fully-populated positive fixture cannot catch a loosened field, and neither can
  // tests/typecheck/schemas.type-assert.ts, which builds exactly such a literal.
  it("requires EVERY key — omitting any one fails (a partial Prisma select must not parse)", () => {
    const keys = Object.keys(validGalleryItemDto);
    expect(keys, "the fixture must cover the whole DTO").toHaveLength(16);
    for (const key of keys) {
      const partial: Record<string, unknown> = { ...validGalleryItemDto };
      delete partial[key];
      expect(
        S.GalleryItemDtoSchema.safeParse(partial).success,
        `omitting ${key} must fail — has it become .optional()/.nullish()?`,
      ).toBe(false);
    }
  });

  it("keeps `translation` on the shared TranslationSchema, not a free string", () => {
    // TranslationSchema is `z.string().min(1)`. A plain `z.string()` here would accept an
    // empty translation and put a blank `· ` on a public card; this is the assertion that
    // fails if the field is ever downgraded.
    expect(
      S.GalleryItemDtoSchema.safeParse({ ...validGalleryItemDto, translation: "" })
        .success,
    ).toBe(false);
    expect(
      S.GalleryItemDtoSchema.safeParse({ ...validGalleryItemDto, translation: "BSB" })
        .success,
    ).toBe(true);
  });
});

describe("Tasks #39/#40 schemas — gallery response envelopes (U-GS3/U-GS4)", () => {
  it("GalleryItemResponseSchema is keyed on `item`, never a bare row", () => {
    expect(
      S.GalleryItemResponseSchema.safeParse({ item: validGalleryItemDto }).success,
    ).toBe(true);
    expect(S.GalleryItemResponseSchema.safeParse(validGalleryItemDto).success).toBe(
      false,
    );
  });

  it("GalleryListResponseSchema is a KEYED envelope — a bare array fails", () => {
    expect(
      S.GalleryListResponseSchema.safeParse({
        items: [validGalleryItemDto],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(S.GalleryListResponseSchema.safeParse([validGalleryItemDto]).success).toBe(
      false,
    );
  });

  it("nextCursor is REQUIRED and nullable (null means genuinely exhausted, so the UI can hide `Load more` honestly)", () => {
    expect(
      S.GalleryListResponseSchema.parse({ items: [], nextCursor: null }).nextCursor,
    ).toBeNull();
    expect(
      S.GalleryListResponseSchema.parse({ items: [], nextCursor: "eyJ9" }).nextCursor,
    ).toBe("eyJ9");
    expect(S.GalleryListResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("items is REQUIRED too (an envelope with no items is a bug, not an empty page)", () => {
    // An empty page is `{ items: [], nextCursor: null }`. If `items` were `.optional()`,
    // a handler that forgot to set it would return `{ nextCursor: null }`, and the grid
    // would crash on `items.map` rather than render zero cards.
    expect(S.GalleryListResponseSchema.safeParse({ nextCursor: null }).success).toBe(
      false,
    );
    expect(
      S.GalleryListResponseSchema.safeParse({ items: [], nextCursor: null }).success,
    ).toBe(true);
  });

  it("declares NO hasMore and NO total (a second field that can disagree with nextCursor)", () => {
    const parsed = S.GalleryListResponseSchema.parse({
      items: [],
      nextCursor: null,
      hasMore: true,
      total: 99,
    }) as Record<string, unknown>;
    expect("hasMore" in parsed).toBe(false);
    expect("total" in parsed).toBe(false);
  });

  it("GalleryDeleteResponseSchema is { ok: true } (the DELETE /v1/projects/:id precedent, not 204)", () => {
    expect(S.GalleryDeleteResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(S.GalleryDeleteResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(S.GalleryDeleteResponseSchema.safeParse({}).success).toBe(false);
  });

  it("GalleryIdParamSchema requires a non-empty id", () => {
    expect(S.GalleryIdParamSchema.safeParse({ id: "gi_1" }).success).toBe(true);
    expect(S.GalleryIdParamSchema.safeParse({ id: "" }).success).toBe(false);
    expect(S.GalleryIdParamSchema.safeParse({}).success).toBe(false);
  });

  it("stream-url REUSES FilePresignDownloadResponseSchema (one presign wire shape)", () => {
    expect(
      S.FilePresignDownloadResponseSchema.safeParse({
        url: "https://s3.example.test/renders/rj_1/output.mp4?X-Amz-Signature=…",
        expiresAt: "2026-07-25T10:02:00.000Z",
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. Barrel exports + no Prisma collision
// ---------------------------------------------------------------------------

describe("Task #7 schemas — barrel exports", () => {
  const exported = [
    "RepoVisibilitySchema",
    "ProjectCreatedFromSchema",
    "ProjectVersionStateSchema",
    "RenderStatusSchema",
    "GalleryVisibilitySchema",
    "AiGenerationKindSchema",
    "AiProviderSchema",
    "ProjectJobKindSchema",
    "JobStatusSchema",
    "TranslationSchema",
    "ProjectManifestSchema",
    "GeneratedStoryboardSchema",
    "SceneVisualPromptSchema",
    "NarrationSpecSchema",
    "MusicSpecSchema",
    "RenderOutputSpecSchema",
    "CompositionSpecSchema",
    "VoiceDescriptorSchema",
    "RenderWorkflowPayloadSchema",
    // Task #37 — render wire DTOs
    "CreateRenderRequestSchema",
    "CreateRenderResponseSchema",
    "RenderJobDtoSchema",
    "RenderJobResponseSchema",
    "RenderJobListResponseSchema",
    "RenderIdParamSchema",
    "RenderListQuerySchema",
    // Tasks #39/#40 — gallery wire DTOs
    "GallerySortSchema",
    "PublishGalleryItemRequestSchema",
    "GalleryItemDtoSchema",
    "GalleryItemResponseSchema",
    "GalleryListResponseSchema",
    "GalleryListQuerySchema",
    "GalleryIdParamSchema",
    "GalleryDeleteResponseSchema",
    // Turn 16a — the watch page's detail contract + the publish-time snapshot
    "GalleryOwnerSchema",
    "GalleryMakingOfSceneSchema",
    "GalleryMakingOfSchema",
    "GalleryItemDetailDtoSchema",
    "GalleryItemDetailResponseSchema",
  ] as const;

  it("re-exports every schema from the package entry as a usable Zod schema", () => {
    const lib = DbLib as unknown as Record<
      string,
      { parse?: unknown; safeParse?: unknown } | undefined
    >;
    for (const name of exported) {
      const schema = lib[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.parse, `${name}.parse`).toBe("function");
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });

  it("still re-exports the Prisma enum consts (no name collision with export *)", () => {
    expect(DbLib.JobStatus).toBeDefined();
    expect(DbLib.RenderStatus).toBeDefined();
    expect(DbLib.AiGenerationKind).toBeDefined();
  });

  it("gallery wire types are *Dto-suffixed so they cannot shadow the Prisma models", () => {
    const lib = DbLib as unknown as Record<string, unknown>;
    // `GalleryItem` / `GalleryUpvote` are generated Prisma model TYPES re-exported by
    // `export * from "./generated/prisma/client"`. A same-named wire schema would be
    // dropped from the barrel, so the DTO is `GalleryItemDtoSchema` (RenderJobDto rule).
    expect(lib.GalleryItemSchema, "GalleryItemSchema must not exist").toBeUndefined();
    expect(lib.GalleryUpvoteSchema, "GalleryUpvoteSchema must not exist").toBeUndefined();
    expect(DbLib.Prisma.GalleryItemScalarFieldEnum).toBeDefined();
    expect(DbLib.Prisma.GalleryUpvoteScalarFieldEnum).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level compile check (mirrors schema.test.ts's tsc gate)
// ---------------------------------------------------------------------------

describe("Task #7 schemas — type-level compile check", () => {
  it("inferred schema types compile and reject bad literals (tsc --noEmit)", () => {
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
        join("tests", "typecheck", "schemas.type-assert.ts"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env } },
    );
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
  }, 120_000);
});
