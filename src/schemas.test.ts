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
