import { z } from "zod";

/**
 * Shared domain Zod schemas (design-delta §2.11).
 *
 * Prisma models are what Postgres persists; these schemas are the OTHER three
 * contracts of the platform:
 *   (a) LLM structured-output contracts (storyboard / reroll-visual),
 *   (b) the `supagloo.project.json` repo-manifest file format,
 *   (c) API wire + audio/render request shapes.
 *
 * Only `AiGeneration.input` / `AiGeneration.resultJson` (and `ProjectJob.stages`)
 * ever persist Zod-shaped JSON inside a Prisma JSON column; everything else lives
 * in the project's GitHub repo (the manifest) or on the wire.
 *
 * The enum mirrors below are written out by hand and pinned to the live Prisma
 * generated enums by a consistency test (src/schemas.test.ts). They are wire /
 * structured-output vocabularies and must stay explicit and stable — an intentional
 * Prisma enum change forces a deliberate edit here, which the test flags. The Prisma
 * enum *types* (re-exported from ./index) remain the source of the value TS types;
 * these schemas add only the runtime validators.
 */

// ---------------------------------------------------------------------------
// Enum mirrors (Schema-suffixed to avoid colliding with the re-exported Prisma
// enum consts of the same bare name). Value sets are drift-checked against the
// generated consts in src/generated/prisma/enums.ts.
// ---------------------------------------------------------------------------

export const RepoVisibilitySchema = z.enum(["private", "public"]);

export const ProjectCreatedFromSchema = z.enum([
  "votd",
  "passage",
  "blank",
  "demo",
  "import",
]);

export const ProjectVersionStateSchema = z.enum([
  "base",
  "working",
  "published",
  "archived",
]);

export const RenderStatusSchema = z.enum([
  "queued",
  "bundling",
  "synthesizing",
  "encoding",
  "uploading",
  "completed",
  "failed",
  "canceled",
]);

export const GalleryVisibilitySchema = z.enum(["public", "unlisted"]);

export const AiGenerationKindSchema = z.enum([
  "storyboard",
  "script",
  "image",
  "narration",
  "music",
  "video",
]);

export const AiProviderSchema = z.enum(["gloo", "openrouter"]);

export const ProjectJobKindSchema = z.enum([
  "scaffold",
  "import_verify",
  "commit",
  "publish",
]);

/** Shared by ProjectJob.status AND AiGeneration.status (one lifecycle). */
export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

// ---------------------------------------------------------------------------
// KJV/BSB generation constraint (§9-Q10). Zod-only — GalleryItem.translation is a
// plain Prisma String, so display can carry any translation; only *generation*
// (manifest + storyboard scenes) is constrained to the two public-domain texts.
// ---------------------------------------------------------------------------

export const TranslationSchema = z.enum(["KJV", "BSB"]);
export type Translation = z.infer<typeof TranslationSchema>;

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

/** `"W:H"` aspect ratio, e.g. `"9:16"`. Not cross-checked against width/height —
 *  it is a display hint; the pixel dimensions are authoritative. */
const aspectRatio = z.string().regex(/^\d+:\d+$/, 'expected a "W:H" ratio like "9:16"');

/** Composition metadata: pixel size, frame rate, aspect-ratio hint. */
export const CompositionSpecSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  aspectRatio,
});
export type CompositionSpec = z.infer<typeof CompositionSpecSchema>;

/** Narrator voice descriptor: a freeform `description` (required) + an optional
 *  punchy `label` (e.g. "JAMES EARL JONES-STYLE"). Reused by the manifest's
 *  project-scoped narrator voice and by NarrationSpec's synthesis input. */
export const VoiceDescriptorSchema = z.object({
  description: z.string().min(1),
  label: z.string().min(1).optional(),
});
export type VoiceDescriptor = z.infer<typeof VoiceDescriptorSchema>;

/** The manifest's music bed: a style descriptor + the cached synthesized audio
 *  asset key (absent/null until generated). */
export const MusicBedSchema = z.object({
  style: z.string().min(1),
  assetKey: z.string().min(1).nullable().optional(),
});
export type MusicBed = z.infer<typeof MusicBedSchema>;

/** The closing end card: a headline line (e.g. "JOHN 1:23 · KJV") + optional
 *  subtext. */
export const EndCardSchema = z.object({
  headline: z.string().min(1),
  subtext: z.string().min(1).optional(),
});
export type EndCard = z.infer<typeof EndCardSchema>;

// ---------------------------------------------------------------------------
// ProjectManifestSchema — the supagloo.project.json file format
// ---------------------------------------------------------------------------

/** One ordered scene in the persisted composition. Carries a stable `id`
 *  (AiGeneration.sceneId points at it), a concrete `durationSeconds`, a
 *  `captions` flag, and the S3 `visualAssetKey` of the generated image/clip
 *  (null/absent until generated). */
export const ManifestSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scriptText: z.string().min(1),
  reference: z.string().min(1),
  translation: TranslationSchema,
  visualPrompt: z.string().min(1),
  durationSeconds: z.number().positive(),
  captions: z.boolean(),
  visualAssetKey: z.string().min(1).nullable().optional(),
});
export type ManifestScene = z.infer<typeof ManifestSceneSchema>;

/**
 * The `supagloo.project.json` manifest — the SOLE source of truth for a project's
 * composition in v1. Validated on every studio read, import-verify, and commit.
 * `scenes` MAY be empty (a freshly-scaffolded project); `narratorVoice` is required
 * (core, project-scoped); `music`/`endCard` are optional (may be unconfigured).
 */
export const ProjectManifestSchema = z.object({
  manifestVersion: z.literal(1),
  composition: CompositionSpecSchema,
  scenes: z.array(ManifestSceneSchema),
  narratorVoice: VoiceDescriptorSchema,
  music: MusicBedSchema.optional(),
  endCard: EndCardSchema.optional(),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

// ---------------------------------------------------------------------------
// GeneratedStoryboardSchema — LLM structured output (passage -> scene breakdown)
// ---------------------------------------------------------------------------

/** One scene as SUGGESTED by the LLM. Deliberately has no `id`, `captions`, or
 *  `visualAssetKey` — those are assigned when the suggestion is turned into a
 *  persisted manifest scene. */
export const StoryboardSceneSchema = z.object({
  name: z.string().min(1),
  scriptText: z.string().min(1),
  reference: z.string().min(1),
  translation: TranslationSchema,
  visualPrompt: z.string().min(1),
  suggestedDurationSeconds: z.number().positive(),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

/** The whole-video storyboard the LLM returns: >=1 scene plus whole-video narrator
 *  voice and music-style suggestions. Parsed before anything is persisted. */
export const GeneratedStoryboardSchema = z.object({
  scenes: z.array(StoryboardSceneSchema).min(1),
  narratorVoice: VoiceDescriptorSchema,
  musicStyle: z.string().min(1),
});
export type GeneratedStoryboard = z.infer<typeof GeneratedStoryboardSchema>;

// ---------------------------------------------------------------------------
// SceneVisualPromptSchema — LLM "↻ Reroll visual" output
// ---------------------------------------------------------------------------

/** The refined image/video prompt returned by a reroll-visual generation.
 *  Deliberately minimal — a reroll refines only the prompt. */
export const SceneVisualPromptSchema = z.object({
  visualPrompt: z.string().min(1),
});
export type SceneVisualPrompt = z.infer<typeof SceneVisualPromptSchema>;

// ---------------------------------------------------------------------------
// NarrationSpecSchema / MusicSpecSchema — audio-synthesis inputs
// ---------------------------------------------------------------------------

/** One per-scene narration script; `sceneId` maps the synthesized audio back to
 *  the manifest scene. */
export const NarrationSceneSchema = z.object({
  sceneId: z.string().min(1),
  scriptText: z.string().min(1),
});
export type NarrationScene = z.infer<typeof NarrationSceneSchema>;

/** Input to narration (TTS) synthesis: the voice descriptor + per-scene scripts. */
export const NarrationSpecSchema = z.object({
  voice: VoiceDescriptorSchema,
  scenes: z.array(NarrationSceneSchema).min(1),
});
export type NarrationSpec = z.infer<typeof NarrationSpecSchema>;

/** Input to music synthesis: a style label + the target duration in seconds. */
export const MusicSpecSchema = z.object({
  style: z.string().min(1),
  durationSeconds: z.number().positive(),
});
export type MusicSpec = z.infer<typeof MusicSpecSchema>;

// ---------------------------------------------------------------------------
// RenderOutputSpecSchema — resolution / aspect / fps / codec
// ---------------------------------------------------------------------------

/** The render output spec: composition metadata plus the codec. Used for render
 *  request validation and mirrored onto RenderJob's width/height/fps/aspectRatio/
 *  codec columns. `codec` (e.g. "h264") is a free string, not an enum, to avoid
 *  rejecting a valid Remotion codec later. */
export const RenderOutputSpecSchema = CompositionSpecSchema.extend({
  codec: z.string().min(1),
});
export type RenderOutputSpec = z.infer<typeof RenderOutputSpecSchema>;
