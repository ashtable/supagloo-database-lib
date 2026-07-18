// Type-level compile check for the Task #7 domain Zod schemas (design-delta §2.11).
// Compiled with `tsc --noEmit` by src/schemas.test.ts. It proves (at the type
// level) that the inferred types are exported and shaped as designed, and — via the
// `@ts-expect-error` directives — that the literal constraints (Translation union,
// manifestVersion literal, required codec) are enforced by the TYPES, not only at
// runtime. If any `@ts-expect-error` stops describing a real error (someone widens a
// type), tsc reports the unused directive and this check fails.

import type {
  CompositionSpec,
  GeneratedStoryboard,
  ManifestScene,
  MusicSpec,
  NarrationSpec,
  ProjectManifest,
  RenderOutputSpec,
  SceneVisualPrompt,
  Translation,
  VoiceDescriptor,
} from "../../src/index";

const translation: Translation = "KJV";
// @ts-expect-error Translation is the "KJV" | "BSB" union — never "NIV"
const badTranslation: Translation = "NIV";

const voice: VoiceDescriptor = {
  description: "warm, weathered baritone",
  label: "JEJ-STYLE",
};

const composition: CompositionSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  aspectRatio: "9:16",
};

const scene: ManifestScene = {
  id: "s1",
  name: "wilderness · dawn",
  scriptText: "I am the voice of one",
  reference: "JOHN 1:23",
  translation,
  visualPrompt: "sweeping empty wilderness at first light",
  durationSeconds: 5,
  captions: true,
  visualAssetKey: null,
};

export const manifest: ProjectManifest = {
  manifestVersion: 1,
  composition,
  narratorVoice: voice,
  scenes: [scene],
};

// @ts-expect-error manifestVersion is the literal 1 in v1, never 2
export const badManifest: ProjectManifest = { ...manifest, manifestVersion: 2 };

export const storyboard: GeneratedStoryboard = {
  scenes: [
    {
      name: "wilderness · dawn",
      scriptText: "I am the voice of one",
      reference: "JOHN 1:23",
      translation: "KJV",
      visualPrompt: "sweeping empty wilderness at first light",
      suggestedDurationSeconds: 5,
    },
  ],
  narratorVoice: voice,
  musicStyle: "Swelling strings",
};

export const reroll: SceneVisualPrompt = { visualPrompt: "a refined prompt" };

export const narration: NarrationSpec = {
  voice,
  scenes: [{ sceneId: "s1", scriptText: "I am the voice of one" }],
};

export const music: MusicSpec = { style: "Swelling strings", durationSeconds: 30 };

export const render: RenderOutputSpec = {
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  fps: 30,
  codec: "h264",
};

// codec is required on a RenderOutputSpec (it is CompositionSpec + codec).
// @ts-expect-error missing required `codec`
export const badRender: RenderOutputSpec = {
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  fps: 30,
};
