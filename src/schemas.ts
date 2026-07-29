import { z } from "zod";
import { JobStageSchema } from "./job-stages";

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
// Translation abbreviation (§9-Q10, broadened 2026-07-18 — supersedes the original
// KJV/BSB-only enum). Generation now sources ANY translation YouVersion licenses to the
// app for the user's chosen language. The *licensed set* is validated at runtime against
// the live "Get a Bible collection" call (task #30 `fetchScripturePassage`), NOT by this
// schema — so this is a non-empty string, not a fixed enum. KJV/BSB remain the
// pre-selected default for new projects; they are no longer the only allowed members.
// (Bible ids are never hardcoded — always resolved via the collection endpoint.)
// ---------------------------------------------------------------------------

export const TranslationSchema = z.string().min(1);
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
 *  project-scoped narrator voice and by NarrationSpec's synthesis input.
 *
 *  Task #35: `assetKey` caches the WHOLE-PROJECT synthesized narration track
 *  (absent/null until generated) — narration is one asset for all scenes'
 *  narration concatenated (§7 workflow 7, decision D5), so it lives here on the
 *  project-scoped voice rather than per scene. Mirrors `MusicBed.assetKey`. Being
 *  optional keeps `GeneratedStoryboardSchema`/`NarrationSpecSchema` (which reuse
 *  this schema) unaffected — the LLM/synth inputs simply omit it.
 *
 *  Feature 1: `voiceId` is the CHOSEN PROVIDER VOICE ID (e.g. `"zac"`), and it is the
 *  only field on this object a provider ever sees. `description`/`label` are freeform
 *  PROSE ("JAMES EARL JONES-STYLE"); they were written, validated, persisted, committed
 *  and snapshotted, and read by zero provider-facing code, because OpenRouter's speech
 *  endpoint takes a NAMED voice and no provider publishes a voice-enumeration API
 *  (verified live 2026-07-29). The studio therefore ships a curated per-model list and
 *  persists the id the user picked; the prose stays as the human-readable intent that
 *  the storyboard LLM also produces.
 *
 *  OPTIONAL, and `manifestVersion` stays `z.literal(1)` — every manifest already
 *  committed to a user's repo must keep parsing byte-for-byte unchanged. Absent ⇒ the
 *  synthesis path falls back to its default provider voice, exactly as before. */
export const VoiceDescriptorSchema = z.object({
  description: z.string().min(1),
  label: z.string().min(1).optional(),
  assetKey: z.string().min(1).nullable().optional(),
  voiceId: z.string().min(1).optional(),
});
export type VoiceDescriptor = z.infer<typeof VoiceDescriptorSchema>;

/** The manifest's music bed: a style descriptor + the cached synthesized audio
 *  asset key (absent/null until generated).
 *
 *  `durationSeconds` is the MEASURED length of the synthesized track, NOT a
 *  requested one. Verified live against OpenRouter: neither Lyria model exposes a
 *  duration parameter (`supported_parameters` is
 *  `["max_tokens","response_format","seed","temperature","top_p"]`), so clip length
 *  is a property of the chosen model — clip-preview yields ~30 s, pro yields a
 *  full-length song. The composition therefore cannot ASK for a bed that spans the
 *  video; it has to FIT the bed it was given, which means looping it, which means
 *  knowing how long it is (`<Loop durationInFrames={round(durationSeconds * fps)}>`).
 *  Optional, so every existing `manifestVersion: 1` manifest keeps parsing. */
export const MusicBedSchema = z.object({
  style: z.string().min(1),
  assetKey: z.string().min(1).nullable().optional(),
  durationSeconds: z.number().positive().optional(),
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

/** The kind of media behind `visualAssetKey`. Both the image and the video
 *  generation workflows write the SAME extensionless key shape
 *  (`projects/{projectId}/assets/{genId}`, see `s3-keys.ts`) and the S3 content-type
 *  is discarded on download, so the manifest is the ONLY place that can record what
 *  the bytes are. Two things depend on knowing:
 *    - a still gets the Ken Burns pan/zoom; a clip must not (it moves already);
 *    - a clip must render through `<OffthreadVideo>`, not `<Img>`.
 *  Absent ⇒ `"image"`, which keeps every existing v1 manifest correct: before this
 *  field existed, EVERY scene was rendered through `<Img>` regardless. */
export const VisualAssetKindSchema = z.enum(["image", "video"]);
export type VisualAssetKind = z.infer<typeof VisualAssetKindSchema>;

/** One ordered scene in the persisted composition. Carries a stable `id`
 *  (AiGeneration.sceneId points at it), a concrete `durationSeconds`, a
 *  `captions` flag, and the S3 `visualAssetKey` of the generated image/clip
 *  (null/absent until generated).
 *
 *  `narrationAssetKey`/`narrationDurationSeconds` are the per-scene half of the
 *  narration track. Narration used to be ONE whole-project asset
 *  (`narratorVoice.assetKey`) mounted at frame 0, outside every `<Sequence>` — there
 *  was no sync mechanism of any kind, so scene 3's verse could be playing over scene
 *  1's picture. Carrying the asset and its MEASURED length per scene is what lets the
 *  generated composition mount each scene's audio inside that scene's own
 *  `<Sequence>`, and what lets `effectiveSceneDurationSeconds` stop a verse being cut
 *  off mid-sentence. `narratorVoice.assetKey` is retained as the whole-video fallback
 *  for manifests written before this existed.
 *
 *  All three fields are OPTIONAL: `manifestVersion` stays `z.literal(1)`, and
 *  already-committed manifests must keep parsing unchanged. */
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
  visualAssetKind: VisualAssetKindSchema.optional(),
  narrationAssetKey: z.string().min(1).nullable().optional(),
  narrationDurationSeconds: z.number().positive().optional(),
});
export type ManifestScene = z.infer<typeof ManifestSceneSchema>;

/**
 * The `supagloo.project.json` manifest — the SOLE source of truth for a project's
 * composition in v1. Validated on every studio read, import-verify, and commit.
 * `scenes` MAY be empty (a freshly-scaffolded project); `narratorVoice` is required
 * (core, project-scoped); `music`/`endCard` are optional (may be unconfigured).
 */
// ---------------------------------------------------------------------------
// AiGenerationSettingsSchema — the genesis-1 Inspector's project-level AI config
// ---------------------------------------------------------------------------

/**
 * The faith-alignment values Gloo's `tradition` request field actually honours.
 *
 * **All four were measured against the live host on 2026-07-28**, by the size of the
 * system prompt Gloo injects (prompt "hi", `max_tokens: 1`, `temperature: 0`): omitted →
 * 757 prompt tokens, `not_faith_specific` → 757, `catholic` → 11253, `evangelical` →
 * 11289, `mainline` → 11275. The content differs substantively too, not just the size.
 *
 * **THERE IS NO `protestant` AND NO `orthodox`.** `evangelical` and `mainline` are the
 * two Protestant-family options Gloo offers. This matters because the obvious guess is
 * wrong in a way nothing will tell you about:
 *
 * **The enum is NOT enforced server-side.** `orthodox`, `protestant`, `reformed`,
 * `pentecostal`, `buddhist`, `null` and a garbage sentinel ALL return **200** and
 * silently collapse to the neutral 757-token baseline. There is no 422. So a wrong value
 * is not an error anyone sees — it is a video that quietly is not faith-aligned. This
 * schema is the only thing that catches it, which is why the value is an enum here and
 * why nothing downstream may send free text.
 *
 * The user-facing word for this is **"faith-aligned"** — the design's own term (10a/10b
 * describe Gloo as "faith-aligned models"). Never "denomination"; never "tradition",
 * which is Gloo's wire name, not ours.
 */
export const FaithAlignmentSchema = z.enum([
  "evangelical",
  "catholic",
  "mainline",
  "not_faith_specific",
]);
export type FaithAlignment = z.infer<typeof FaithAlignmentSchema>;

/** One kind's generation target. `model` is OPTIONAL on purpose: "use Gloo, with whatever
 *  model the system currently defaults to" is a real (and the DEFAULT) user intent, and
 *  the default is resolved server-side per deployment rather than frozen into a file
 *  committed to the user's GitHub repo. Pinning a model is the override, not the norm. */
export const AiModelChoiceSchema = z.object({
  provider: AiProviderSchema,
  model: z.string().min(1).optional(),
});
export type AiModelChoice = z.infer<typeof AiModelChoiceSchema>;

/**
 * Project-level AI generation settings (genesis-1 Inspector, decisions D-A/D-B).
 *
 * PROJECT-level, not per-scene, and deliberately so. A model choice is a configuration
 * of the project, not content of a scene: a per-scene choice would make the user re-pick
 * a model 5–10 times (the opposite of "know the cost of iterating"), and a per-scene
 * `faithAlignment` would let scene 3 argue with scene 4. Going project-level → per-scene
 * later is an additive optional field; the reverse is a manifest migration.
 *
 * Only the four kinds the Inspector offers a selector for appear here. The text kinds
 * (`storyboard`/`script`) have no selector, so giving them a slot would imply a control
 * that does not exist. Explicit keys (rather than a record) also make the canonical
 * on-disk field order trivially fixed — `canonicalizeManifest` needs that.
 */
export const AiGenerationSettingsSchema = z.object({
  faithAlignment: FaithAlignmentSchema.optional(),
  image: AiModelChoiceSchema.optional(),
  narration: AiModelChoiceSchema.optional(),
  music: AiModelChoiceSchema.optional(),
  video: AiModelChoiceSchema.optional(),
});
export type AiGenerationSettings = z.infer<typeof AiGenerationSettingsSchema>;

/**
 * Feature 2 — the project's ORIGIN passage, chosen in the New-project wizard's step 2
 * (figure 18a) before any scene exists.
 *
 * PROJECT-level, not per-scene, and necessarily so. `ManifestSceneSchema` requires
 * `scriptText`/`visualPrompt`/`name`/`durationSeconds` alongside `reference`/
 * `translation`, so seeding the selection as a scene would mean INVENTING generated
 * content the user never asked for and committing it to their GitHub repo — content
 * which `STORYBOARD_GENERATED` then replaces wholesale on the very next action. The
 * origin passage is also project-shaped in fact: it survives a re-plan; a scene does not.
 *
 * `passageId` is the YouVersion USFM **exactly as the chapters/verses routes handed it
 * out**. It is ECHOED, never constructed — `contracts.ts` closed constructing one as
 * residual risk, and nothing here re-opens it.
 *
 * `language` is the picker's BCP-47 tag (`"en"`), persisted so a non-English project
 * stops being silently re-resolved against English (`sceneScriptureContext` used to
 * hardcode `"eng"`).
 *
 * **It deliberately does NOT carry the passage TEXT.** The manifest is committed into
 * the user's (possibly public) repo, the verse text is third-party licensed content, and
 * `passageId` is enough to re-fetch it.
 */
export const ManifestScriptureSchema = z.object({
  reference: z.string().min(1),
  translation: TranslationSchema,
  language: z.string().min(1).optional(),
  passageId: z.string().min(1).optional(),
});
export type ManifestScripture = z.infer<typeof ManifestScriptureSchema>;

export const ProjectManifestSchema = z.object({
  manifestVersion: z.literal(1),
  composition: CompositionSpecSchema,
  scenes: z.array(ManifestSceneSchema),
  narratorVoice: VoiceDescriptorSchema,
  music: MusicBedSchema.optional(),
  endCard: EndCardSchema.optional(),
  /** Feature 2: the passage this project was created from (wizard step 2). OPTIONAL, and
   *  `manifestVersion` deliberately stays `z.literal(1)` — every manifest already
   *  committed to a user's repo must keep parsing byte-for-byte unchanged. */
  scripture: ManifestScriptureSchema.optional(),
  /** Genesis-1: the project's AI provider/model choices + faith alignment. OPTIONAL, and
   *  `manifestVersion` deliberately stays `z.literal(1)` — every manifest already
   *  committed to a user's repo must keep parsing byte-for-byte unchanged. */
  aiSettings: AiGenerationSettingsSchema.optional(),
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
// GeneratedScriptSchema — LLM structured output for the `script` kind (Task #30)
// ---------------------------------------------------------------------------

/** The `script`-kind LLM result: single-scene text (§2.8). The scripture-text triple —
 *  the regenerated `scriptText` plus the `reference`/`translation` it is based on (records
 *  which translation the text is in). Deliberately omits the storyboard-composition fields
 *  (name/visualPrompt/duration), which belong to storyboard assembly, not a single-scene
 *  text regeneration — symmetric with `SceneVisualPromptSchema` being just the prompt. */
export const GeneratedScriptSchema = z.object({
  scriptText: z.string().min(1),
  reference: z.string().min(1),
  translation: TranslationSchema,
});
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;

// ---------------------------------------------------------------------------
// generateScript workflow input (Task #30) — the subset of `AiGeneration.input` the
// storyboard/script workflow reads. The full request is Zod-validated at enqueue (#31);
// `.passthrough()` lets that richer contract add fields without breaking this workflow.
// ---------------------------------------------------------------------------

/** The scripture a generation is based on. Its PRESENCE on the input drives the workflow's
 *  optional `fetchScripturePassage` step (VOTD/passage origins); topic-origin generations
 *  omit it. `translation` is the abbreviation the user selected (validated against the live
 *  YouVersion collection at generation time, §9-Q10); `language` scopes the collection call. */
export const ScripturePassageRequestSchema = z.object({
  reference: z.string().min(1),
  translation: z.string().min(1),
  language: z.string().min(1).default("eng"),
});
export type ScripturePassageRequest = z.infer<typeof ScripturePassageRequestSchema>;

/** The `AiGeneration.input` subset for the storyboard/script kinds: a generation `brief`
 *  (the instruction the LLM works from) + an optional `scripture` block. */
export const GenerateScriptInputSchema = z
  .object({
    brief: z.string().min(1),
    scripture: ScripturePassageRequestSchema.optional(),
  })
  .passthrough();
export type GenerateScriptInput = z.infer<typeof GenerateScriptInputSchema>;

/** The DBOS enqueue payload for `generateScript`. Everything the workflow needs is read
 *  from the `AiGeneration` row (keyed by the workflow id); the payload just echoes the
 *  generation id (= workflow id) so the API's enqueue call is self-describing. */
export const GenerateScriptPayloadSchema = z.object({
  generationId: z.string().min(1),
});
export type GenerateScriptPayload = z.infer<typeof GenerateScriptPayloadSchema>;

// ---------------------------------------------------------------------------
// generateImage workflow input + payload (Task #32) — the subset of
// `AiGeneration.input` the image workflow reads. Replaces the task-31
// `MediaGenerationInputSchema` placeholder for the `image` kind.
// ---------------------------------------------------------------------------

/** The `AiGeneration.input` for the `image` kind: the text→image `prompt` the model
 *  generates from. `.passthrough()` (same discipline as `GenerateScriptInputSchema`) lets a
 *  future richer contract add fields (size/seed/negativePrompt) without breaking the
 *  workflow. Distinct from `SceneVisualPromptSchema`, which is an LLM *output* schema
 *  (the "↻ Reroll visual" result), not a generation *input*. */
export const GenerateImageInputSchema = z
  .object({
    prompt: z.string().min(1),
  })
  .passthrough();
export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

/** The DBOS enqueue payload for `generateImage`. Same `{generationId}` echo as
 *  `generateScript` — everything else is read off the `AiGeneration` row. */
export const GenerateImagePayloadSchema = z.object({
  generationId: z.string().min(1),
});
export type GenerateImagePayload = z.infer<typeof GenerateImagePayloadSchema>;

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

/** Input to narration (TTS) synthesis: the voice descriptor + per-scene scripts.
 *
 *  Feature 1: `voiceId` is the CHOSEN PROVIDER VOICE ID, and it is a TOP-LEVEL sibling of
 *  `voice` rather than a property of it — deliberately. The provider takes a named voice
 *  and nothing else; `voice.description`/`voice.label` are prose that no provider request
 *  has a field for (`requestSpeech` sends exactly
 *  `{model, input, voice, response_format}`). Separating the one value that is SENT from
 *  the prose that is not makes the synthesis boundary honest about what it can act on.
 *
 *  It is also what lets the fix ship ahead of the db-lib gitlink bump: this schema is
 *  wrapped by `GenerateNarrationInputSchema = NarrationSpecSchema.passthrough()`, so a
 *  top-level key survives an older pinned copy of this file untouched, exactly as
 *  `faithAlignment` already does for image generations.
 *
 *  Absent ⇒ the synthesis path falls back to its default provider voice. */
export const NarrationSpecSchema = z.object({
  voice: VoiceDescriptorSchema,
  voiceId: z.string().min(1).optional(),
  scenes: z.array(NarrationSceneSchema).min(1),
});
export type NarrationSpec = z.infer<typeof NarrationSpecSchema>;

/** One synthesized per-scene narration clip: which scene it belongs to, where its
 *  bytes landed, and how long it actually turned out to be. */
export const NarrationResultSceneSchema = z.object({
  sceneId: z.string().min(1),
  assetKey: z.string().min(1),
  /** MEASURED from the returned audio bytes — the input to scene/narration length
   *  reconciliation. OPTIONAL, mirroring `ManifestScene.narrationDurationSeconds`:
   *  if a container ever comes back that we cannot measure honestly, the clip is
   *  still worth recording (it can still be mounted inside its own scene's
   *  `<Sequence>`, which is most of the fix) and only the stretch is lost. A
   *  fabricated number here would silently mis-time every scene, which is strictly
   *  worse than an absent one. */
  durationSeconds: z.number().positive().optional(),
});
export type NarrationResultScene = z.infer<typeof NarrationResultSceneSchema>;

/**
 * The narration generation's OUTPUT map, carried in `AiGeneration.resultJson`.
 *
 * An `AiGeneration` row has exactly ONE `resultAssetKey`, and that invariant is not
 * being changed — narration synthesis now produces one asset PER SCENE, and the extra
 * keys live here. `resultAssetKey` still names a single object (the first scene's), so
 * every existing consumer of the row keeps working; the studio reads this map to write
 * per-scene `narrationAssetKey`/`narrationDurationSeconds` into the manifest.
 *
 * Rejected alternative: one `AiGeneration` row per scene. The studio's generation-slot
 * model, the BFF, the API route and the render-progress UI all assume one row per user
 * action, so N rows is a four-repo redesign that buys the user nothing over a map.
 */
export const NarrationResultSchema = z.object({
  scenes: z.array(NarrationResultSceneSchema),
});
export type NarrationResult = z.infer<typeof NarrationResultSchema>;

/** Input to music synthesis: a style label + the target duration in seconds. */
export const MusicSpecSchema = z.object({
  style: z.string().min(1),
  durationSeconds: z.number().positive(),
});
export type MusicSpec = z.infer<typeof MusicSpecSchema>;

// ---------------------------------------------------------------------------
// Task #33: the `AiGeneration.input` contracts for the two audio kinds
// (design-delta §7 workflow 7). Named `Generate<Kind>InputSchema` for parity with
// `GenerateScriptInputSchema`/`GenerateImageInputSchema` (each kind's create-union
// input); `.passthrough()` (same forward-compat discipline as image/script) lets a
// future richer contract add fields (format/speed/tempo) without breaking the
// generateAudio workflow, which validates the row's `input` with these SAME schemas.
// They reuse the task-7 `NarrationSpecSchema`/`MusicSpecSchema` rather than duplicating.
// ---------------------------------------------------------------------------

/** The `AiGeneration.input` for the `narration` kind: the WHOLE-PROJECT narration spec —
 *  one voice descriptor + the per-scene scripts (the generateAudio workflow concatenates
 *  them into one synthesized track — design §7 workflow 7, decision D5). */
export const GenerateNarrationInputSchema = NarrationSpecSchema.passthrough();
export type GenerateNarrationInput = z.infer<typeof GenerateNarrationInputSchema>;

/** The `AiGeneration.input` for the `music` kind: a style label + target duration. */
export const GenerateMusicInputSchema = MusicSpecSchema.passthrough();
export type GenerateMusicInput = z.infer<typeof GenerateMusicInputSchema>;

/** The DBOS enqueue payload for `generateAudio` (narration + music). Same `{generationId}`
 *  echo as generateScript/generateImage — everything else is read off the row. */
export const GenerateAudioPayloadSchema = z.object({
  generationId: z.string().min(1),
});
export type GenerateAudioPayload = z.infer<typeof GenerateAudioPayloadSchema>;

// ---------------------------------------------------------------------------
// Task #34: the `AiGeneration.input` contract for the `video` kind (design-delta §7
// workflow 8). Replaces the task-31 `MediaGenerationInputSchema` passthrough placeholder
// (video was the LAST placeholder kind, so that schema is now removed). Named
// `Generate<Kind>InputSchema` for parity with script/image/narration/music.
//
// DOMAIN shape is camelCase (like `durationSeconds`/`aspectRatio` elsewhere); the
// generateVideo workflow's pure `buildVideoSubmitInput` maps these to OpenRouter's
// snake_case body (`duration`/`aspect_ratio`/`frame_images`/`generate_audio`) at the wire
// boundary — mirroring how generateAudio's `buildSpeechArgs` maps the narration/music spec.
// `.passthrough()` (image/audio/script forward-compat discipline) lets a future richer
// contract add fields without breaking the workflow. Only `prompt` is required (design lists
// `model` + `prompt` as core, the rest as optional); the rest are optional so a caller sends
// exactly what the chosen video model needs.
// ---------------------------------------------------------------------------

/** The `AiGeneration.input` for the `video` kind: the generation `prompt` plus optional
 *  clip parameters. `frameImages` carries source frames for image-to-video (asset keys or
 *  URLs); `aspectRatio` reuses the `"W:H"` hint pattern; `resolution` is a free string. */
export const GenerateVideoInputSchema = z
  .object({
    prompt: z.string().min(1),
    durationSeconds: z.number().positive().optional(),
    resolution: z.string().min(1).optional(),
    aspectRatio: aspectRatio.optional(),
    frameImages: z.array(z.string().min(1)).min(1).optional(),
    generateAudio: z.boolean().optional(),
    seed: z.number().int().optional(),
  })
  .passthrough();
export type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

/** The DBOS enqueue payload for `generateVideo`. Same `{generationId}` echo as the other
 *  generation workflows — everything else is read off the `AiGeneration` row. */
export const GenerateVideoPayloadSchema = z.object({
  generationId: z.string().min(1),
});
export type GenerateVideoPayload = z.infer<typeof GenerateVideoPayloadSchema>;

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

/**
 * The DBOS enqueue payload for `renderWorkflow` (task #36). Same single-id echo as the
 * generation workflows (`{generationId}`) and the git-ops ones (`{jobId}`-shaped): the
 * `workflowID` IS the RenderJob id, and everything the workflow needs — project, version
 * branch, user, output spec — is read off the `RenderJob` row (and its Project/
 * ProjectVersion relations) inside the first step. Carrying only the id keeps the enqueue
 * contract impossible to desynchronize from the row.
 */
export const RenderWorkflowPayloadSchema = z.object({
  renderJobId: z.string().min(1),
});
export type RenderWorkflowPayload = z.infer<typeof RenderWorkflowPayloadSchema>;

// ===========================================================================
// Auth / session WIRE DTOs (Task #10 — design-delta §2.1/§2.2/§6a/§8)
// ---------------------------------------------------------------------------
// The FIRST request/response (wire) DTOs in this file — everything above is
// domain/content. These are the API<->BFF contract for sign-in, session, and the
// flag-gated test-seed endpoint. Date fields are ISO-8601 strings on the wire
// (the Prisma models carry real Date columns; the API serializes them).
//
// The wire user is `AuthUser` (NOT `User`): the Prisma `User`/`Session` model
// TYPES are re-exported from this package via `export * from generated/prisma`,
// so a wire schema named `UserSchema`/`User` would collide. Keeping it `AuthUser`
// keeps both the star-export and these DTOs importable side by side.
// ===========================================================================

/** The authenticated user as returned to clients (design-delta §2.1). Prisma
 *  `DateTime` columns are serialized as ISO-8601 strings; `onboardingCompletedAt`
 *  is null until onboarding is completed. */
export const AuthUserSchema = z.object({
  id: z.string(),
  youversionUserId: z.string(),
  displayName: z.string(),
  email: z.string(),
  avatarInitials: z.string(),
  firstSignInAt: z.string(),
  onboardingCompletedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * UNVERIFIED display fields the browser read out of its YouVersion session.
 *
 * These are deliberately NOT trustworthy and nothing may key off them. The reason is a
 * property of the provider, verified live 2026-07-27: a YouVersion access token carries
 * `{sub, scope, iss, exp, iat, jti, client_id}` and NO profile claims, there is no
 * `userinfo_endpoint` in its OIDC discovery document, and `@youversion/platform-core`
 * never exposes the raw `id_token` (only fields it has already decoded, and it does not
 * verify signatures). So the server CANNOT independently obtain a name or an email —
 * the only options are to take the client's word for them or to have none at all.
 *
 * That is safe only because of where the trust boundary sits: `User.youversionUserId`
 * comes from `sub` on a SIGNATURE-VERIFIED access token and is the `@unique` identity
 * key every lookup and every authorization decision uses. `User.email` is a plain
 * non-unique column that is never looked up by. If either of those two facts ever
 * changes, this schema becomes a privilege-escalation vector and must be revisited.
 */
export const YouVersionSignInProfileSchema = z.object({
  /** Display name. Absent for a sparse YouVersion profile. */
  name: z.string().optional(),
  email: z.string().optional(),
  /** Avatar URL template from the SDK; stored for display only. */
  profilePicture: z.string().optional(),
});
export type YouVersionSignInProfile = z.infer<
  typeof YouVersionSignInProfileSchema
>;

/** `POST /v1/auth/youversion` request: the YouVersion access token the browser
 *  obtained client-side and the BFF forwards for server-side verification, plus the
 *  optional UNVERIFIED {@link YouVersionSignInProfileSchema} display fields. `profile`
 *  is optional so an older BFF keeps working — sign-in then falls back to placeholders
 *  rather than failing. */
export const YouVersionSignInRequestSchema = z.object({
  accessToken: z.string().min(1),
  profile: YouVersionSignInProfileSchema.optional(),
});
export type YouVersionSignInRequest = z.infer<
  typeof YouVersionSignInRequestSchema
>;

/** `POST /v1/auth/youversion` response: the raw opaque session token (only its
 *  SHA-256 hash is persisted), the user, and a transient `firstSignIn` flag —
 *  true iff this sign-in created the user row. */
export const YouVersionSignInResponseSchema = z.object({
  token: z.string().min(1),
  user: AuthUserSchema,
  firstSignIn: z.boolean(),
});
export type YouVersionSignInResponse = z.infer<
  typeof YouVersionSignInResponseSchema
>;

/** `GET /v1/me` response. */
export const MeResponseSchema = z.object({
  user: AuthUserSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** `PATCH /v1/me/onboarding` response (the user with `onboardingCompletedAt`
 *  now set). */
export const OnboardingResponseSchema = z.object({
  user: AuthUserSchema,
});
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

/** `POST /v1/auth/signout` response. Revocation is DB-backed (§9-Q6): the
 *  session row is deleted, so `ok:true` means the token is invalidated now. */
export const SignoutResponseSchema = z.object({
  ok: z.literal(true),
});
export type SignoutResponse = z.infer<typeof SignoutResponseSchema>;

/** One user to (idempotently) seed. `sessionToken` is the RAW bearer token the
 *  test will send; the endpoint stores only its SHA-256 hash. */
export const TestSeedUserSchema = z.object({
  youversionUserId: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().min(1),
  avatarInitials: z.string().min(1),
  sessionToken: z.string().min(1),
  onboardingCompleted: z.boolean().optional(),
});
export type TestSeedUser = z.infer<typeof TestSeedUserSchema>;

/** `POST /v1/test/seed` request (flag-gated, §9-Q9): deterministic users +
 *  sessions so e2e can bearer-auth without a real YouVersion OAuth flow. */
export const TestSeedRequestSchema = z.object({
  users: z.array(TestSeedUserSchema).min(1),
});
export type TestSeedRequest = z.infer<typeof TestSeedRequestSchema>;

/** `POST /v1/test/seed` response: each seeded user plus the raw bearer token
 *  that now authenticates as it. */
export const TestSeedResponseSchema = z.object({
  users: z
    .array(
      z.object({
        user: AuthUserSchema,
        token: z.string().min(1),
      }),
    )
    .min(1),
});
export type TestSeedResponse = z.infer<typeof TestSeedResponseSchema>;

// ===========================================================================
// GitHub connection WIRE DTOs (Task #11 — design-delta §2.3/§6a/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the GitHub App connection surface: install-url,
// callback (verify via App JWT → store), disconnect, and live repo listing. We
// store ONLY the installation pointer (never a repo token); repo-operation tokens
// are minted on demand (see ./github `mintInstallationToken`). `connectedAt` is an
// ISO-8601 string on the wire (the Prisma model carries a real Date column).
//
// The stored wire connection is `GithubConnectionStatus` (NOT `GithubConnection`):
// the Prisma `GithubConnection` model TYPE is re-exported via `export * from
// generated/prisma`, so a wire type of the same name would collide and be dropped
// from the barrel (same reason the auth wire user is `AuthUser`, not `User`).
// ===========================================================================

/** `GET /v1/connections/github/install-url` response: the GitHub App's hosted
 *  installation-picker URL (`{oauthBase}/apps/{slug}/installations/new`). */
export const GithubInstallUrlResponseSchema = z.object({
  url: z.string().min(1),
});
export type GithubInstallUrlResponse = z.infer<
  typeof GithubInstallUrlResponseSchema
>;

/** `POST /v1/connections/github/callback` request: the installation id GitHub
 *  redirected back with. Accepted as a string OR a number (GitHub emits it
 *  numerically; our BFF forwards `{installationId}`) and normalized to a string
 *  (the Prisma column is `String`). */
export const GithubCallbackRequestSchema = z.object({
  installationId: z
    .union([z.string().min(1), z.number().int().positive()])
    .transform((v) => String(v)),
});
export type GithubCallbackRequest = z.infer<typeof GithubCallbackRequestSchema>;

/**
 * `GET /v1/connections/github/authorize-url` query — the USER-authorization hop for
 * linking an installation that already exists.
 *
 * The install callback cannot cover this case, and not as an edge case: GitHub only
 * redirects to the App's Setup URL when an installation is CREATED. A user who already
 * installed the App — a reinstall, an install made from GitHub's own directory, or the
 * same App registration shared between environments — is sent straight to the
 * installation's settings page, so nothing ever posts an `installationId` and the
 * connect flow has no path to completion.
 *
 * So we ask GitHub who the user is instead: authorize, then read
 * `GET /user/installations` and match. Mirrors `RepoAuthorizeUrlQuerySchema` (the
 * create-repo JIT hop) — same hosted-authorization shape, different destination.
 */
export const GithubAuthorizeUrlQuerySchema = z.object({
  redirectUri: z.string().min(1),
  state: z.string().min(1),
});
export type GithubAuthorizeUrlQuery = z.infer<
  typeof GithubAuthorizeUrlQuerySchema
>;

/** `GET /v1/connections/github/authorize-url` response: the hosted GitHub
 *  user-authorization URL. No user secret crosses this wire. */
export const GithubAuthorizeUrlResponseSchema = z.object({
  url: z.string().min(1),
});
export type GithubAuthorizeUrlResponse = z.infer<
  typeof GithubAuthorizeUrlResponseSchema
>;

/**
 * `POST /v1/connections/github/link-existing` request: the user-authorization `code`
 * GitHub redirected back with.
 *
 * The code is exchanged server-side for a short-lived user token, used once to read
 * `GET /user/installations`, and discarded — the same zero-storage posture as the
 * create-repo hop. Only the resolved installation pointer is persisted.
 */
export const GithubLinkExistingRequestSchema = z.object({
  code: z.string().min(1),
});
export type GithubLinkExistingRequest = z.infer<
  typeof GithubLinkExistingRequestSchema
>;

/** A stored GitHub App connection on the wire (design-delta §2.3). No token
 *  field exists — the installation id is the only stored credential-pointer.
 *  Named `GithubConnectionStatus` to avoid colliding with the re-exported Prisma
 *  `GithubConnection` model type. */
export const GithubConnectionStatusSchema = z.object({
  githubLogin: z.string(),
  installationId: z.string(),
  repositorySelection: z.string(),
  status: z.string(),
  connectedAt: z.string(),
});
export type GithubConnectionStatus = z.infer<
  typeof GithubConnectionStatusSchema
>;

/** `POST /v1/connections/github/callback` response. */
export const GithubConnectionResponseSchema = z.object({
  connection: GithubConnectionStatusSchema,
});
export type GithubConnectionResponse = z.infer<
  typeof GithubConnectionResponseSchema
>;

/** `DELETE /v1/connections/github` response (idempotent). */
export const GithubDisconnectResponseSchema = z.object({
  ok: z.literal(true),
});
export type GithubDisconnectResponse = z.infer<
  typeof GithubDisconnectResponseSchema
>;

/** `GET /v1/github/repos?filter=` — a CLOSED two-value enum (not free text). */
export const GithubRepoFilterSchema = z.enum(["empty", "all"]);
export type GithubRepoFilter = z.infer<typeof GithubRepoFilterSchema>;

/** One repo in the live listing (design-delta §8, wizards 12b/13a).
 *
 *  `empty` means "has no project in it yet, so it is safe to scaffold into", and
 *  the API derives it in two stages (plan row 65). GitHub's `size` is KB-rounded
 *  and computed asynchronously, so it lags UPWARD and never overstates: `size > 0`
 *  therefore short-circuits to NOT empty with no further request. Only the
 *  `size === 0` candidates are probed, with
 *  `GET /repos/:owner/:repo/commits?per_page=2` — a `409 "Git Repository is empty"`
 *  or a `200` with <= 1 commit means empty; >= 2 commits means not empty. The
 *  <= 1 rule is deliberate: a repo created with `auto_init` holds exactly one
 *  README commit and is still an empty project. */
export const GithubRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  empty: z.boolean(),
});
export type GithubRepo = z.infer<typeof GithubRepoSchema>;

/** `GET /v1/github/repos` response (already filtered by `filter`/`q`). */
export const GithubRepoListResponseSchema = z.object({
  repositories: z.array(GithubRepoSchema),
});
export type GithubRepoListResponse = z.infer<
  typeof GithubRepoListResponseSchema
>;

// ===========================================================================
// OpenRouter + Gloo connection WIRE DTOs (Task #12 — design-delta §2.5/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the two provider-secret connections plus the merged
// GET /v1/connections. The per-user secrets (OpenRouter key, Gloo client secret)
// are AES-256-GCM-encrypted at rest (§2.10, database-lib `encryptSecret`) and NEVER
// cross the wire — the status DTOs carry only display-safe fragments (`keyLast4`,
// `clientId`). Date fields are ISO-8601 strings (the Prisma models carry real Date
// columns; the API serializes them).
//
// Wire types are `*ConnectionStatus`-suffixed (NOT bare `OpenRouterConnection` /
// `GlooConnection`): those bare names are re-exported Prisma model types via
// `export * from generated/prisma`, so a same-named wire type would collide and be
// dropped from the barrel (same rule as `GithubConnectionStatus`, `AuthUser`).
//
// Endpoint asymmetry is intentional (§8): OpenRouter is created with POST (the
// browser already did PKCE — no server-side callback), Gloo with PUT (verify-then-
// store — a client-credentials test mint must succeed before any row is written).
// ===========================================================================

/** `POST /v1/connections/openrouter` request: the OpenRouter API key the browser
 *  obtained via PKCE and the BFF forwards. Encrypted before storage; `keyLast4`
 *  (last 4 chars) is derived from it at write time for masked display. */
export const OpenRouterConnectRequestSchema = z.object({
  key: z.string().min(1),
});
export type OpenRouterConnectRequest = z.infer<
  typeof OpenRouterConnectRequestSchema
>;

/** A stored OpenRouter connection on the wire. Carries ONLY the masked
 *  `keyLast4` (never the key/ciphertext); the UI composes `sk-or-••••••{keyLast4}`. */
export const OpenRouterConnectionStatusSchema = z.object({
  keyLast4: z.string(),
  status: z.string(),
  connectedAt: z.string(),
});
export type OpenRouterConnectionStatus = z.infer<
  typeof OpenRouterConnectionStatusSchema
>;

/** `POST /v1/connections/openrouter` response. */
export const OpenRouterConnectionResponseSchema = z.object({
  connection: OpenRouterConnectionStatusSchema,
});
export type OpenRouterConnectionResponse = z.infer<
  typeof OpenRouterConnectionResponseSchema
>;

/** `GET /v1/connections/openrouter/credits` response: a live proxy to OpenRouter's
 *  balance (never stored). `remaining = totalCredits − totalUsage`; the UI renders
 *  `$X.XX credit remaining`. */
export const OpenRouterCreditsResponseSchema = z.object({
  totalCredits: z.number(),
  totalUsage: z.number(),
  remaining: z.number(),
});
export type OpenRouterCreditsResponse = z.infer<
  typeof OpenRouterCreditsResponseSchema
>;

/** `DELETE /v1/connections/openrouter` response (idempotent). */
export const OpenRouterDisconnectResponseSchema = z.object({
  ok: z.literal(true),
});
export type OpenRouterDisconnectResponse = z.infer<
  typeof OpenRouterDisconnectResponseSchema
>;

/** `PUT /v1/connections/gloo` request: the Gloo OAuth2 client-credentials pair.
 *  The API mints a client-credentials test token to VERIFY the pair BEFORE storing
 *  it; `clientSecret` is encrypted at rest, `clientId` is kept plaintext. */
export const GlooConnectRequestSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type GlooConnectRequest = z.infer<typeof GlooConnectRequestSchema>;

/** A stored Gloo connection on the wire. Carries the plaintext `clientId` and the
 *  verification timestamps — NEVER the client secret / its ciphertext. */
export const GlooConnectionStatusSchema = z.object({
  clientId: z.string(),
  status: z.string(),
  connectedAt: z.string(),
  lastVerifiedAt: z.string(),
});
export type GlooConnectionStatus = z.infer<typeof GlooConnectionStatusSchema>;

/** `PUT /v1/connections/gloo` response. */
export const GlooConnectionResponseSchema = z.object({
  connection: GlooConnectionStatusSchema,
});
export type GlooConnectionResponse = z.infer<
  typeof GlooConnectionResponseSchema
>;

/** `DELETE /v1/connections/gloo` response (idempotent). */
export const GlooDisconnectResponseSchema = z.object({
  ok: z.literal(true),
});
export type GlooDisconnectResponse = z.infer<
  typeof GlooDisconnectResponseSchema
>;

/** `GET /v1/connections` response (design-delta §2.5 footnote / §8): the merged
 *  status of all three typed connection tables, keyed by provider. Each value is
 *  the provider's status object, or `null` when that provider is not connected. */
export const ConnectionsResponseSchema = z.object({
  github: GithubConnectionStatusSchema.nullable(),
  openrouter: OpenRouterConnectionStatusSchema.nullable(),
  gloo: GlooConnectionStatusSchema.nullable(),
});
export type ConnectionsResponse = z.infer<typeof ConnectionsResponseSchema>;

// ===========================================================================
// Files WIRE DTOs (Task #13 — S3 presigned download, design-delta §4/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the single presigned-download route
// `GET /v1/files/presign-download?key=`. The API presigns a short-lived GET URL
// against S3_PUBLIC_ENDPOINT (browser-reachable) after scoping the requested key
// to the caller. Uploads (server-side worker ops) and DELETE (cleanup workflow)
// are intentionally NOT exposed here. There is no `File` Prisma model, so these
// names do not collide with anything in the generated-client barrel.
// ===========================================================================

/** `GET /v1/files/presign-download` query: the S3 object key to presign. Ownership
 *  of the key is enforced server-side (a foreign or unknown key → 404). */
export const FilePresignDownloadQuerySchema = z.object({
  key: z.string().min(1),
});
export type FilePresignDownloadQuery = z.infer<
  typeof FilePresignDownloadQuerySchema
>;

/** `GET /v1/files/presign-download` response: a short-lived presigned GET URL and
 *  its absolute expiry (ISO-8601). The URL is signed against the public endpoint so
 *  a browser can fetch it directly. */
export const FilePresignDownloadResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type FilePresignDownloadResponse = z.infer<
  typeof FilePresignDownloadResponseSchema
>;

// ===========================================================================
// Projects / Versions WIRE DTOs (Task #14 — design-delta §2.6/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the first Project/ProjectVersion read+mutate surface:
// the workspace grid (`GET /v1/projects`), per-project get/rename/soft-delete
// (`GET/PATCH/DELETE /v1/projects/:id`), and the version list
// (`GET /v1/projects/:id/versions`). The create/import/commit/publish endpoints are
// separate, later, DBOS-backed tasks (#18–22) — not modeled here.
//
// Wire types are `*Dto`-suffixed (NOT bare `Project` / `ProjectVersion`): those bare
// names are the Prisma model TYPES re-exported via `export * from generated/prisma`,
// so a same-named wire type would collide and be dropped from the barrel (same rule
// as `AuthUser`, `GithubConnectionStatus`). The enum fields reuse the mirrors
// declared at the top of this file (`RepoVisibilitySchema`, `ProjectCreatedFromSchema`,
// `ProjectVersionStateSchema`). Date columns are ISO-8601 strings on the wire.
// ===========================================================================

/** A `Project` on the wire (design-delta §2.6). Carries every scalar the workspace
 *  grid (10a card) and studio header need. `ownerId` is intentionally omitted (the
 *  caller is always the owner — precedent: the connection DTOs omit `userId`) and so
 *  is `deletedAt` (soft-deleted projects are filtered out of every response, so the
 *  field would be a perpetually-null noise). `lastOpenedAt`/`createdAt` are ISO-8601. */
export const ProjectDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  repoVisibility: RepoVisibilitySchema,
  createdFrom: ProjectCreatedFromSchema,
  currentBranch: z.string(),
  thumbnailAssetKey: z.string().nullable(),
  lastRenderJobId: z.string().nullable(),
  lastOpenedAt: z.string(),
  createdAt: z.string(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

/** A `ProjectVersion` on the wire (design-delta §2.6 — the 14b version dropdown).
 *  `changedFiles` is the persisted JSON array of change descriptors (e.g.
 *  `"M src/scenes/Shelter.tsx"`); `commitMessage`/`autoSummary`/`headCommitSha`/
 *  `prNumber`/`prUrl`/`publishedAt` are null until a commit/publish populates them. */
export const ProjectVersionDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  semver: z.string(),
  branchName: z.string(),
  state: ProjectVersionStateSchema,
  commitMessage: z.string().nullable(),
  autoSummary: z.string().nullable(),
  changedFiles: z.array(z.string()),
  headCommitSha: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  prUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type ProjectVersionDto = z.infer<typeof ProjectVersionDtoSchema>;

/** Shared `:id` path param for the per-project routes. */
export const ProjectIdParamSchema = z.object({
  id: z.string().min(1),
});
export type ProjectIdParam = z.infer<typeof ProjectIdParamSchema>;

/** `PATCH /v1/projects/:id` request. `name` is the ONLY editable field (design-delta
 *  §2.6 "editable in studio top bar"); the slug is a stable URL identity and is never
 *  regenerated on rename. */
export const ProjectRenameRequestSchema = z.object({
  name: z.string().min(1),
});
export type ProjectRenameRequest = z.infer<typeof ProjectRenameRequestSchema>;

/** `GET /v1/projects` response: the owner's non-deleted projects (workspace grid),
 *  most-recently-opened first. Wrapped in a keyed object (not a bare array) per the
 *  established list-response convention. */
export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectDtoSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

/** `GET /v1/projects/:id` and `PATCH /v1/projects/:id` response. */
export const ProjectResponseSchema = z.object({
  project: ProjectDtoSchema,
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

/** `DELETE /v1/projects/:id` response (soft delete — the row remains, only
 *  `deletedAt` is set). A repeat delete on an already-deleted project 404s. */
export const ProjectDeleteResponseSchema = z.object({
  ok: z.literal(true),
});
export type ProjectDeleteResponse = z.infer<typeof ProjectDeleteResponseSchema>;

/** `GET /v1/projects/:id/versions` response: the project's versions ordered by real
 *  semver descending (newest first — the 14b dropdown). */
export const ProjectVersionListResponseSchema = z.object({
  versions: z.array(ProjectVersionDtoSchema),
});
export type ProjectVersionListResponse = z.infer<
  typeof ProjectVersionListResponseSchema
>;

// ===========================================================================
// Project job creation + polling WIRE DTOs (Task #18 — design-delta §5.1/§6b/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `POST /v1/projects` (create Project + scaffold
// ProjectJob, then DBOSClient.enqueue) and `GET /v1/projects/:id/jobs/:jobId` (stage
// polling). Plus `ScaffoldProjectPayloadSchema` — the EXACT argument the API's enqueue
// call passes to the scaffoldProject workflow (the API<->DBOS contract, shared so the
// worker and the enqueuer can never drift on the payload shape). Date columns are
// ISO-8601 strings on the wire; `stages` reuses the shared JobStage contract
// (./job-stages), the same shape the DBOS workflow updates.
// ===========================================================================

/** `POST /v1/projects` request (design-delta §6b: `{ name, repo, visibility,
 *  createdFrom }`). `repo` is decomposed to `repoOwner` + `repoName` (the repo already
 *  exists — created by the pre-endpoint create-new-repo hop, task 26). `name` is
 *  optional and defaults to the repo name server-side (wireframe 12a/13a). */
export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).optional(),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  visibility: RepoVisibilitySchema,
  createdFrom: ProjectCreatedFromSchema,
  /** Feature 2: the passage picked in the wizard's step 2, seeded into the scaffolded
   *  manifest's `scripture` block. OPTIONAL — a `blank` project omits it and the
   *  scaffolded manifest is byte-identical to today's. `createdFrom` needs no change:
   *  `"passage"` has been in `ProjectCreatedFromSchema` since Task #7. */
  scripture: ManifestScriptureSchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/** `POST /v1/projects` response: the new project id + the scaffold job id (=
 *  the DBOS workflow id the client polls). */
export const CreateProjectResponseSchema = z.object({
  projectId: z.string(),
  jobId: z.string(),
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;

/** A `ProjectJob` on the wire (design-delta §2.9) — the scaffold-progress poll shape.
 *  `stages` is the shared `{key,label,state}[]` progress log; `error`/`completedAt` are
 *  null until the job terminates. `createdAt`/`completedAt` are ISO-8601. */
export const ProjectJobDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: ProjectJobKindSchema,
  status: JobStatusSchema,
  stages: z.array(JobStageSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ProjectJobDto = z.infer<typeof ProjectJobDtoSchema>;

/** `GET /v1/projects/:id/jobs/:jobId` response. */
export const ProjectJobResponseSchema = z.object({
  job: ProjectJobDtoSchema,
});
export type ProjectJobResponse = z.infer<typeof ProjectJobResponseSchema>;

/** `:id` + `:jobId` path params for the job-polling route. */
export const ProjectJobParamsSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
});
export type ProjectJobParams = z.infer<typeof ProjectJobParamsSchema>;

/** The `scaffoldProject` workflow argument (the API<->DBOS enqueue contract). The
 *  repo already EXISTS; everything the workflow needs rides this payload (the
 *  per-user `installationId` and the generated `manifest` are not in the DB). The
 *  worker validates against this on entry; the API constructs + enqueues it. */
export const ScaffoldProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  ownerId: z.string().min(1),
  installationId: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  repoVisibility: RepoVisibilitySchema,
  createdFrom: ProjectCreatedFromSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  manifest: ProjectManifestSchema,
});
export type ScaffoldProjectPayload = z.infer<typeof ScaffoldProjectPayloadSchema>;

// ===========================================================================
// Import-project WIRE + enqueue DTOs (Task #19 — design-delta §7 workflow 2 / §8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `POST /v1/projects/import` (create Project + import_verify
// ProjectJob, then DBOSClient.enqueue(importProject)) and the API<->DBOS enqueue
// payload. Import points at an EXISTING Supagloo repo and DISCOVERS its manifest +
// origin from the clone — so, unlike the scaffold request/payload, neither the request
// nor the payload carries a `manifest` or a `createdFrom` (`createdFrom` is always
// `import`; the manifest lives in the repo). Polling reuses the Task #18
// `ProjectJobDto`/`ProjectJobParams` (kind-agnostic) — no new poll DTO here.
// ===========================================================================

/** `POST /v1/projects/import` request (wireframe 12b repo picker): the existing repo to
 *  import + its visibility. `name` is optional and defaults to the repo name
 *  server-side. No `createdFrom` (always import) and no `manifest` (read from the repo). */
export const ImportProjectRequestSchema = z.object({
  name: z.string().min(1).optional(),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  visibility: RepoVisibilitySchema,
});
export type ImportProjectRequest = z.infer<typeof ImportProjectRequestSchema>;

/** `POST /v1/projects/import` response: the new project id + the import job id (=
 *  the DBOS workflow id the client polls via the shared `GET .../jobs/:jobId`). */
export const ImportProjectResponseSchema = z.object({
  projectId: z.string(),
  jobId: z.string(),
});
export type ImportProjectResponse = z.infer<typeof ImportProjectResponseSchema>;

/** The `importProject` workflow argument (the API<->DBOS enqueue contract). Mirrors
 *  `ScaffoldProjectPayloadSchema` MINUS `manifest` + `createdFrom`: the workflow clones
 *  the existing repo and discovers those from it. `.strip()` (Zod default) drops any
 *  stray `manifest`/`createdFrom` a caller bolts on, so the payload can never smuggle a
 *  composition. The worker validates against this on entry; the API constructs it. */
export const ImportProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  ownerId: z.string().min(1),
  installationId: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  repoVisibility: RepoVisibilitySchema,
  slug: z.string().min(1),
  name: z.string().min(1),
});
export type ImportProjectPayload = z.infer<typeof ImportProjectPayloadSchema>;

// ===========================================================================
// Create-new-repo JIT hop WIRE DTOs (Task #26 — design-delta §2.3/§6b/§8)
// ---------------------------------------------------------------------------
// The zero-storage GitHub USER-token hop that runs BEFORE `POST /v1/projects` for
// the create-new-repo origin: installation tokens can't create a repo in a user
// account, so the user authorizes once, the server exchanges the `code` for a
// short-lived user token, `POST /user/repos` creates the repo (+ adds it to a
// `selected`-mode installation), the token is discarded, and the endpoint then
// delegates to the existing create-project+scaffold path — returning the same
// `{ projectId, jobId }` as `POST /v1/projects` (CreateProjectResponseSchema).
// ===========================================================================

/** `GET /v1/projects/repo-authorize-url` query: the BFF's own callback URL the
 *  GitHub user-authorization page redirects back to, plus an opaque CSRF `state`
 *  nonce the browser round-trips. */
export const RepoAuthorizeUrlQuerySchema = z.object({
  redirectUri: z.string().min(1),
  state: z.string().min(1),
});
export type RepoAuthorizeUrlQuery = z.infer<typeof RepoAuthorizeUrlQuerySchema>;

/** `GET /v1/projects/repo-authorize-url` response: the hosted GitHub
 *  user-authorization URL the wizard opens (client_id + redirect_uri + scope +
 *  state). No user secret crosses this wire. */
export const RepoAuthorizeUrlResponseSchema = z.object({
  url: z.string().min(1),
});
export type RepoAuthorizeUrlResponse = z.infer<typeof RepoAuthorizeUrlResponseSchema>;

/** `POST /v1/projects/create-repo` request: the user-authorization `code` plus the
 *  new repo's `repoName` + `visibility` and the project `createdFrom` origin (v1 =
 *  `blank`). `name` is optional (defaults to the repo name server-side). The repo
 *  OWNER is determined by GitHub from the user token — not supplied by the client.
 *  The response reuses `CreateProjectResponseSchema` (`{ projectId, jobId }`). */
export const CreateRepoRequestSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).optional(),
  repoName: z.string().min(1),
  visibility: RepoVisibilitySchema,
  createdFrom: ProjectCreatedFromSchema,
  /** Feature 2, the OTHER wizard payload site. The create-new-repo tab posts here and the
   *  existing-empty tab posts to `POST /v1/projects`; carrying the passage on only one of
   *  them would make the feature work on one tab and silently do nothing on the other. */
  scripture: ManifestScriptureSchema.optional(),
});
export type CreateRepoRequest = z.infer<typeof CreateRepoRequestSchema>;

// ===========================================================================
// Commit-version WIRE + enqueue DTOs (Task #21 — design-delta §7 workflow 3 / §8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `POST /v1/projects/:id/commit` (create a `commit`
// ProjectJob, then DBOSClient.enqueue(commitVersion)) and the API<->DBOS enqueue payload.
// The request carries the EDITED manifest + a commit message; the manifest is validated
// against `ProjectManifestSchema` (whose `TranslationSchema` accepts any non-empty licensed
// abbreviation per §9-Q10, so only a structurally-invalid manifest is rejected at the
// boundary — the licensed set is validated against the live collection). The payload additionally carries the
// working `branchName` + the working version's `semver` (so the workflow can clone the
// right branch and key `updateVersionRecord`'s upsert without an extra DB round-trip) plus
// the installation/repo coordinates. Task 21 UPDATES the existing working ProjectVersion
// in place (same semver, same branch) — it does NOT create a version or bump semver.
// Polling reuses the Task #18 `ProjectJobDto`/`ProjectJobParams` (kind-agnostic).
// ===========================================================================

/** `POST /v1/projects/:id/commit` request (design-delta §8: `{ manifest, message }`). The
 *  manifest is the edited composition to persist; `message` is the real user-supplied
 *  commit message (non-empty). The manifest is validated against `ProjectManifestSchema`. */
export const CommitVersionRequestSchema = z.object({
  manifest: ProjectManifestSchema,
  message: z.string().min(1),
});
export type CommitVersionRequest = z.infer<typeof CommitVersionRequestSchema>;

/** `POST /v1/projects/:id/commit` response: the new commit job id (= the DBOS workflow id
 *  the client polls via the shared `GET .../jobs/:jobId`). The project is already known
 *  (it is the `:id` in the URL), so only the job id is returned. */
export const CommitVersionResponseSchema = z.object({
  jobId: z.string(),
});
export type CommitVersionResponse = z.infer<typeof CommitVersionResponseSchema>;

/** The `commitVersion` workflow argument (the API<->DBOS enqueue contract). Everything the
 *  workflow needs before step 1 rides this payload: the installation/repo coordinates, the
 *  working `branchName` to clone+commit+push, the working version's `semver` (keys
 *  `updateVersionRecord`'s upsert), and the edited `manifest` + `message`. The worker
 *  validates against this on entry; the API constructs + enqueues it. */
export const CommitVersionPayloadSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  installationId: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  branchName: z.string().min(1),
  semver: z.string().min(1),
  manifest: ProjectManifestSchema,
  message: z.string().min(1),
});
export type CommitVersionPayload = z.infer<typeof CommitVersionPayloadSchema>;

// ===========================================================================
// Publish-version WIRE + enqueue DTOs (Task #22 — design-delta §7 workflow 4 / §8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `POST /v1/projects/:id/publish` (create a `publish`
// ProjectJob, then DBOSClient.enqueue(publishVersion)) and the API<->DBOS enqueue payload.
// Unlike commit, publish carries NO manifest — the request is `{ message }` only. The
// working manifest was already persisted onto the working branch via prior
// commitVersionWorkflow calls; publish merges that branch to `main`, tags the release, and
// cuts the next working branch. The payload carries the working `branchName` (the PR head)
// and the working version's `semver` (the version being published — it names the release
// tag `v<semver>` and keys `finalizeRecords`' published-version upsert) plus the
// installation/repo coordinates. The next version is derived IN the workflow via
// `nextPatchVersion` (bump-patch of the highest existing semver), not passed in.
// Polling reuses the Task #18 `ProjectJobDto`/`ProjectJobParams` (kind-agnostic).
// ===========================================================================

/** `POST /v1/projects/:id/publish` request (design-delta §8: `{ message }` — string only,
 *  no manifest, unlike commit). The publish/release message (non-empty). */
export const PublishVersionRequestSchema = z.object({
  message: z.string().min(1),
});
export type PublishVersionRequest = z.infer<typeof PublishVersionRequestSchema>;

/** `POST /v1/projects/:id/publish` response: the new publish job id (= the DBOS workflow id
 *  the client polls via the shared `GET .../jobs/:jobId`). */
export const PublishVersionResponseSchema = z.object({
  jobId: z.string(),
});
export type PublishVersionResponse = z.infer<typeof PublishVersionResponseSchema>;

/** The `publishVersion` workflow argument (the API<->DBOS enqueue contract). Everything the
 *  workflow needs before step 1 rides this payload: the installation/repo coordinates, the
 *  working `branchName` to publish (the PR head), the working version's `semver` (the version
 *  being published — names the tag + keys the published upsert), and the `message`. Mirrors
 *  `CommitVersionPayloadSchema` MINUS `manifest`. The worker validates against this on
 *  entry; the API constructs + enqueues it. */
export const PublishVersionPayloadSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  installationId: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  branchName: z.string().min(1),
  semver: z.string().min(1),
  message: z.string().min(1),
});
export type PublishVersionPayload = z.infer<typeof PublishVersionPayloadSchema>;

// ===========================================================================
// Manifest read WIRE DTOs (Task #20 — design-delta §5.3/§6b/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `GET /v1/projects/:id/manifest?ref=`. The API reads
// `supagloo.project.json` from the project's GitHub repo at `ref` via the GitHub
// Contents API (a synchronous in-process read — NOT a DBOS workflow), validates it
// against the task-7 `ProjectManifestSchema`, and returns the Zod-parsed manifest so
// the studio reducer (#27) can hydrate from it. There is no `Manifest` Prisma model,
// so these names do not collide with anything in the generated-client barrel.
// ===========================================================================

/** `GET /v1/projects/:id/manifest` query: the git ref (version branch or SHA) to
 *  read the manifest at. OPTIONAL — when omitted the API defaults it to the project's
 *  `currentBranch`. A non-empty string when present. */
export const ManifestRefQuerySchema = z.object({
  ref: z.string().min(1).optional(),
});
export type ManifestRefQuery = z.infer<typeof ManifestRefQuerySchema>;

/** `GET /v1/projects/:id/manifest` response: the Zod-parsed `supagloo.project.json`
 *  composition (design-delta §2.11 — the manifest is the sole source of truth for the
 *  composition; it is read from the repo, never a DB table). */
export const ManifestResponseSchema = z.object({
  manifest: ProjectManifestSchema,
});
export type ManifestResponse = z.infer<typeof ManifestResponseSchema>;

// ===========================================================================
// AI generations WIRE DTOs (Task #31 — design-delta §2.8/§7/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the four AI-generation endpoints (POST create + enqueue,
// GET by id, GET project-scoped list, POST cancel). `AiGeneration.id` IS the DBOS
// workflow id; the enqueue payload is the existing `GenerateScriptPayloadSchema`
// (`{generationId}`) — everything else is read off the row.
//
// The create request is a discriminated union on `kind` so the Fastify/Zod boundary
// validates the kind-specific `input` structurally (→ 400 on a bad/unknown kind or
// malformed input) with no service branching. The kind->provider COMPATIBILITY matrix
// (`AI_PROVIDERS_BY_KIND` in ./workflows) is a SEMANTIC check enforced by the service
// (→ 422), deliberately NOT folded into this union, so the two gates keep distinct
// status codes. Every kind now carries its REAL input schema (`GenerateScriptInputSchema`
// for the text kinds; `GenerateImage/Narration/Music/VideoInputSchema` for the media kinds,
// wired in #32–34) — there is no longer a passthrough placeholder member.
// ===========================================================================

// Fields shared by every create-generation variant (spread into each union member so
// the discriminant `kind` + its per-kind `input` stay explicit). `projectId`/`sceneId`
// are optional (a generation may have no project and no manifest scene).
const aiGenerationCreateBase = {
  provider: AiProviderSchema,
  model: z.string().min(1),
  projectId: z.string().min(1).optional(),
  sceneId: z.string().min(1).optional(),
} as const;

/** `POST /v1/ai/generations` request body (design-delta §8, sequence diagram (b):
 *  `{kind, provider, model, projectId, sceneId, input}`). Discriminated on `kind` so the
 *  kind-specific `input` is validated at the wire boundary. Each kind carries its own real
 *  input schema (text → `GenerateScriptInputSchema`; image/narration/music/video → their
 *  `Generate<Kind>InputSchema`). */
export const CreateAiGenerationRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("storyboard"),
    ...aiGenerationCreateBase,
    input: GenerateScriptInputSchema,
  }),
  z.object({
    kind: z.literal("script"),
    ...aiGenerationCreateBase,
    input: GenerateScriptInputSchema,
  }),
  z.object({
    kind: z.literal("image"),
    ...aiGenerationCreateBase,
    // Task #32: the `image` kind now carries its REAL input contract (requires a prompt).
    input: GenerateImageInputSchema,
  }),
  z.object({
    kind: z.literal("narration"),
    ...aiGenerationCreateBase,
    // Task #33: the `narration` kind now carries its REAL input contract (voice + scenes).
    input: GenerateNarrationInputSchema,
  }),
  z.object({
    kind: z.literal("music"),
    ...aiGenerationCreateBase,
    // Task #33: the `music` kind now carries its REAL input contract (style + duration).
    input: GenerateMusicInputSchema,
  }),
  z.object({
    kind: z.literal("video"),
    ...aiGenerationCreateBase,
    // Task #34: the `video` kind now carries its REAL input contract (requires a prompt).
    input: GenerateVideoInputSchema,
  }),
]);
export type CreateAiGenerationRequest = z.infer<
  typeof CreateAiGenerationRequestSchema
>;

/** An `AiGeneration` on the wire (design-delta §2.8) — the poll shape the client reads
 *  after create. Omits `userId` (the caller is the owner — connection-DTO precedent),
 *  `providerJobId` (internal), and `input` (a lean status+result view, like
 *  `ProjectJobDto`). `resultJson`/`tokenUsage` are pass-through JSON (their shape varies
 *  by kind and was validated by the workflow when written). `resultAssetKey` is the RAW
 *  key — the client presigns it via `GET /v1/files/presign-download?key=` (that route
 *  ownership-scopes it), so this DTO stays a pure row projection with no S3 coupling.
 *  `createdAt`/`completedAt` are ISO-8601. */
export const AiGenerationDtoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  sceneId: z.string().nullable(),
  kind: AiGenerationKindSchema,
  provider: AiProviderSchema,
  model: z.string(),
  status: JobStatusSchema,
  resultJson: z.unknown().nullable(),
  resultAssetKey: z.string().nullable(),
  error: z.string().nullable(),
  tokenUsage: z.unknown().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AiGenerationDto = z.infer<typeof AiGenerationDtoSchema>;

/** `POST /v1/ai/generations` response — the new generation's id (= workflow id). Mirrors
 *  `POST /v1/projects` returning ids only; the client polls `GET /:id`. */
export const CreateAiGenerationResponseSchema = z.object({
  generationId: z.string(),
});
export type CreateAiGenerationResponse = z.infer<
  typeof CreateAiGenerationResponseSchema
>;

/** `GET /v1/ai/generations/:id` and `POST /v1/ai/generations/:id/cancel` response. */
export const AiGenerationResponseSchema = z.object({
  generation: AiGenerationDtoSchema,
});
export type AiGenerationResponse = z.infer<typeof AiGenerationResponseSchema>;

/** `GET /v1/projects/:id/generations` response — the project's generations, newest
 *  first. */
export const AiGenerationListResponseSchema = z.object({
  generations: z.array(AiGenerationDtoSchema),
});
export type AiGenerationListResponse = z.infer<
  typeof AiGenerationListResponseSchema
>;

/** `:id` path param for the by-id / cancel routes (the project-scoped list reuses
 *  `ProjectIdParamSchema`). */
export const AiGenerationIdParamSchema = z.object({
  id: z.string().min(1),
});
export type AiGenerationIdParam = z.infer<typeof AiGenerationIdParamSchema>;

// ===========================================================================
// Render WIRE DTOs (Task #37 — design-delta §2.7/§2.11/§6c/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the five render endpoints:
//   POST /v1/projects/:id/renders · GET /v1/renders/:id ·
//   POST /v1/renders/:id/cancel  · GET /v1/renders?mine=1 ·
//   GET  /v1/renders/:id/download   (reuses FilePresignDownloadResponseSchema)
//
// `RenderJob.id` IS the DBOS workflow id, so the create response is ids-only
// (`{ renderJobId }`, exactly the §6c sequence) and the client polls `GET /:id`.
// The enqueue payload is the already-shipped `RenderWorkflowPayloadSchema`
// (`{ renderJobId }` — task 36); everything else is read off the row.
//
// The five output-spec COLUMNS (width/height/fps/aspectRatio/codec, design §2.7)
// stay flat in Postgres but are re-nested into a single `outputSpec` on the wire so
// the request and the response carry the SAME `RenderOutputSpecSchema` object — a
// spec that validates on the way in always renders on the way out. This is the same
// no-drift argument task 36 made for validating the row columns with the API's own
// schema.
// ===========================================================================

/** `POST /v1/projects/:id/renders` request body (design-delta §6c / §8). The project
 *  comes from the path; `versionId` is the `ProjectVersion` the worker clones.
 *  `runInBackground` is a UI hint ONLY (§2.7 — the job is always async server-side) and
 *  defaults to `false` because the column is non-nullable with no DB default. */
export const CreateRenderRequestSchema = z.object({
  versionId: z.string().min(1),
  outputSpec: RenderOutputSpecSchema,
  runInBackground: z.boolean().default(false),
});
export type CreateRenderRequest = z.infer<typeof CreateRenderRequestSchema>;

/** `POST /v1/projects/:id/renders` response — the new render's id (= the DBOS workflow
 *  id). Ids-only, mirroring `CreateAiGenerationResponseSchema` / `POST /v1/projects`. */
export const CreateRenderResponseSchema = z.object({
  renderJobId: z.string(),
});
export type CreateRenderResponse = z.infer<typeof CreateRenderResponseSchema>;

/** A `RenderJob` on the wire (design-delta §2.7) — the poll shape driving the 14c
 *  overlay. Omits `userId` (the caller is the owner — connection-DTO precedent).
 *  `outputAssetKey`/`thumbnailAssetKey` are the RAW keys; the client gets a URL from
 *  `GET /v1/renders/:id/download` (or the generic presign route), so this DTO stays a
 *  pure row projection with no S3 coupling. Dates are ISO-8601.
 *
 *  NOTE for the UI (task 38): `status: "queued"` with a NON-null `startedAt` means the
 *  worker has already picked the job up and is cloning/installing/downloading assets —
 *  task 36's `markRenderStarted` deliberately sets `startedAt` without changing status.
 *  `framesTotal` stays 0 until the worker's `bundleComposition` resolves the composition. */
export const RenderJobDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  status: RenderStatusSchema,
  framesDone: z.number().int(),
  framesTotal: z.number().int(),
  outputSpec: RenderOutputSpecSchema,
  outputAssetKey: z.string().nullable(),
  thumbnailAssetKey: z.string().nullable(),
  runInBackground: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type RenderJobDto = z.infer<typeof RenderJobDtoSchema>;

/** `GET /v1/renders/:id` and `POST /v1/renders/:id/cancel` response. */
export const RenderJobResponseSchema = z.object({
  render: RenderJobDtoSchema,
});
export type RenderJobResponse = z.infer<typeof RenderJobResponseSchema>;

/** `GET /v1/renders?mine=1` response — the caller's renders, newest first ("Your
 *  videos", Turn 15 / task 41). Keyed envelope, never a bare array. */
export const RenderJobListResponseSchema = z.object({
  renders: z.array(RenderJobDtoSchema),
});
export type RenderJobListResponse = z.infer<typeof RenderJobListResponseSchema>;

/** `:id` path param for the render by-id / cancel / download routes (the create route
 *  reuses `ProjectIdParamSchema`). */
export const RenderIdParamSchema = z.object({
  id: z.string().min(1),
});
export type RenderIdParam = z.infer<typeof RenderIdParamSchema>;

/** `GET /v1/renders` querystring. `mine` is REQUIRED and must be the literal `"1"`:
 *  there is no cross-user render listing in v1 (it would leak other users' work), so a
 *  bare `GET /v1/renders` must fail loudly rather than quietly return the caller's own
 *  rows under a URL that reads like "all renders". Closed-value query param, following
 *  `GithubRepoFilterSchema` (an enum, not free text). */
export const RenderListQuerySchema = z.object({
  mine: z.literal("1"),
});
export type RenderListQuery = z.infer<typeof RenderListQuerySchema>;

// ===========================================================================
// Gallery WIRE DTOs (Tasks #39/#40 — design-delta §2.7/§6c/§8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for the community gallery:
//   POST   /v1/renders/:id/gallery      (publish; owner)
//   DELETE /v1/gallery/:id              (un-publish; owner)
//   GET    /v1/gallery                  (PUBLIC listing — optional auth)
//   GET    /v1/gallery/:id              (PUBLIC item — optional auth)
//   GET    /v1/gallery/:id/stream-url   (PUBLIC presign; reuses
//                                        FilePresignDownloadResponseSchema)
//   POST   /v1/gallery/:id/upvote  ·  DELETE /v1/gallery/:id/upvote  (auth)
//
// Naming: `GalleryItem` and `GalleryUpvote` are generated Prisma model TYPES
// re-exported by `export * from "./generated/prisma/client"`, so the wire type takes
// the `*Dto` suffix (the `RenderJobDto` / `ProjectDto` rule) — a same-named wire type
// would be silently dropped from the barrel.
//
// Deliberate DTO omissions, each load-bearing:
//   - `videoAssetKey` is NOT on the DTO. A public consumer must go through
//     `stream-url`; handing out the raw key invites clients to guess sibling keys.
//   - `ownerId` is NOT on the DTO; `owner.{displayName, avatarInitials}` is. Exposing
//     an internal user id on an unauthenticated endpoint is gratuitous.
//     KNOWN DESIGN GAP: the wireframe's `@handle` has no column — `displayName` is the
//     honest stand-in until the design adds one.
//   - `viewCount` is NOT on the DTO. The column exists (design-delta §2.7) but §8
//     defines no endpoint that increments or exposes it, and shipping a field that is
//     always 0 is a lie. Recorded as a known gap, not an oversight.
//
// Dates are ISO-8601 strings. `nextCursor` is `string | null` — see the cursor
// contract on GalleryListResponseSchema.
// ===========================================================================

/** Gallery listing order. A CLOSED enum because the API selects its ORDER BY key
 *  expression from a fixed map keyed by this value — the request string never reaches
 *  the SQL. `popular` is the default (design-delta §2.7); `trending` is computed at
 *  query time from `upvoteCount` + `publishedAt` with an injected `now`. */
export const GallerySortSchema = z.enum(["popular", "newest", "trending"]);
export type GallerySort = z.infer<typeof GallerySortSchema>;

/** `POST /v1/renders/:id/gallery` request body (design-delta §6c).
 *
 *  The render comes from the path. `scriptureReference` + `translation` are CLIENT-
 *  supplied because the server does not have them: `RenderJob` carries neither, and
 *  reading the repo manifest would put real GitHub egress into what §7 calls "a single
 *  Postgres insert". The studio already holds both values, so the UI sends them with no
 *  extra fetch.
 *
 *  Everything else is SERVER-derived and deliberately absent here:
 *  `scriptureBook` (via `deriveScriptureBook`, a null derivation is a 422),
 *  `durationSeconds` (`max(1, round(framesTotal / fps))` — letting the client claim a
 *  duration would let the `mm:ss` badge lie about its own video), and both asset keys
 *  (recomputed from `buildRenderOutputKey`/`buildRenderThumbnailKey`, never trusted
 *  from the client).
 *
 *  `description` defaults to `""` and `visibility` to `"public"` because both columns
 *  are non-null with no DB default.
 *
 *  `title` and `scriptureReference` are TRIMMED BEFORE the length checks, so a
 *  whitespace-only value is a 400 rather than an invisible title on a public card, and
 *  the stored value never carries incidental padding. Both are single-line display
 *  strings that this schema alone owns; `translation` is left to the shared
 *  `TranslationSchema` so there is still exactly one translation contract. */
export const PublishGalleryItemRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(""),
  scriptureReference: z.string().trim().min(1).max(120),
  translation: TranslationSchema,
  visibility: GalleryVisibilitySchema.default("public"),
});
export type PublishGalleryItemRequest = z.infer<
  typeof PublishGalleryItemRequestSchema
>;

/** A `GalleryItem` on the wire — the card contract for the Turn-15 grid.
 *
 *  `scriptureBook` is the derived USFM code (`deriveScriptureBook`); for a multi-book
 *  reference it is the FIRST recognized book, while `scriptureReference` still renders
 *  verbatim on the card — so only the derived code is coarsened, never the display.
 *  Nothing queries on it: the listing offers sort + free-text `q` and no book filter.
 *
 *  `rank` is 1-based, CONTINUOUS ACROSS PAGES (page 2 of a 24-item page starts at 25),
 *  and non-null ONLY under an UNFILTERED `sort=popular` — it is null under every other
 *  sort AND null whenever `q` is set. Rank is a property of the UNFILTERED popular
 *  ordering, so: a client computing `index + 1` would badge the 25th item "#1"; a "#7"
 *  badge under a different ordering would assert something untrue; and a rank counted
 *  over SEARCH HITS would badge the 7th match "#7" when it is nowhere near 7th in the
 *  gallery. The `rank <= 3` threshold and the trophy-at-1 rule are PRESENTATION and
 *  live in the UI.
 *
 *  `viewerHasUpvoted` is false for an anonymous viewer (no query is issued at all).
 *  `thumbnailUrl` is a short-lived presigned GET URL (the anonymous grid cannot use the
 *  auth-scoped `GET /v1/files/presign-download`), and is null when it cannot be signed. */
/** The public projection of a gallery item's owner. Named (rather than inline) because
 *  the Turn-16a watch page extends it with `publicVideoCount` and the two shapes must
 *  provably share a base — see `GalleryItemDetailDtoSchema`.
 *
 *  KNOWN DESIGN GAP (unchanged): the wireframes draw an `@handle`; no such column exists
 *  on `User`, so `displayName` is the honest stand-in. */
export const GalleryOwnerSchema = z.object({
  displayName: z.string(),
  avatarInitials: z.string(),
});
export type GalleryOwner = z.infer<typeof GalleryOwnerSchema>;

export const GalleryItemDtoSchema = z.object({
  id: z.string(),
  renderJobId: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  scriptureReference: z.string(),
  scriptureBook: z.string(),
  translation: TranslationSchema,
  durationSeconds: z.number().int(),
  visibility: GalleryVisibilitySchema,
  publishedAt: z.string(),
  upvoteCount: z.number().int(),
  thumbnailUrl: z.string().nullable(),
  rank: z.number().int().nullable(),
  viewerHasUpvoted: z.boolean(),
  owner: GalleryOwnerSchema,
});
export type GalleryItemDto = z.infer<typeof GalleryItemDtoSchema>;

/** `POST /v1/renders/:id/gallery` (201), `GET /v1/gallery/:id`, and both upvote
 *  routes. The vote routes return the CURRENT item — count and `viewerHasUpvoted`
 *  re-read after the transaction — so the UI reconciles its optimistic update against
 *  server truth in one round trip. */
export const GalleryItemResponseSchema = z.object({
  item: GalleryItemDtoSchema,
});
export type GalleryItemResponse = z.infer<typeof GalleryItemResponseSchema>;

// ---------------------------------------------------------------------------
// Turn 16a — the "making of" snapshot (GalleryItem.makingOf) + the detail DTO
// ---------------------------------------------------------------------------
//
// The watch page (`/gallery/:id`) renders WHERE THE VIDEO CAME FROM: the scripture text,
// the scene breakdown, and chips for narrator voice / music / captions. None of that is
// on `GalleryItem` — it lives in the project's `supagloo.project.json` manifest, in the
// user's GitHub repo.
//
// It is snapshotted ONCE, at publish time, by the authenticated owner (who already has an
// installation token), and stored on the row. The public read never touches GitHub:
//   - a public page must not hold, mint, or imply an installation token; and
//   - re-reading per view would put a GitHub round trip on an anonymous, crawlable route
//     — and would show TODAY's manifest under a video rendered from an older one, which
//     is the more subtle lie of the two.
//
// The snapshot is BEST EFFORT. A missing/failed/corrupt manifest read leaves the column
// NULL and the publish still succeeds; the watch page then omits those sections. Every
// item published before this column existed is `null` for the same reason, so `null` is a
// permanent, first-class case — never a defect to backfill away.
//
// DELIBERATELY ABSENT, both recorded as documented gaps rather than invented here:
//   - a VISUAL-STYLE field. The design draws a `Cosmic visuals` chip; nothing in the
//     manifest backs it (scenes carry a per-scene `visualPrompt`, which is a prompt, not
//     a style). Chips render conditionally and that one is simply not emitted.
//   - a per-scene IMAGE. The design's scene tiles are deterministic gradients, so there
//     is no asset key to snapshot and no presigned-URL-per-scene to sign on a public page.

/** The C0 controls the snapshot's display strings EXEMPT: tab, LF, CR — and only those.
 *  A scripture paragraph joined from several scenes may legitimately carry a newline. */
const JSONB_TEXT_EXEMPT_CONTROL_CODES: readonly number[] = [
  0x09, // TAB
  0x0a, // LF
  0x0d, // CR
];

/** C0 (U+0000–U+001F) + DEL (U+007F) less the exempt codes, DERIVED from that list so the
 *  class and its documentation cannot drift apart. */
const JSONB_FORBIDDEN_CONTROL_CHARS = new RegExp(
  `[${[...Array.from({ length: 32 }, (_, i) => i), 0x7f]
    .filter((code) => !JSONB_TEXT_EXEMPT_CONTROL_CODES.includes(code))
    .map((code) => `\\u${code.toString(16).padStart(4, "0")}`)
    .join("")}]`,
);

/** A UTF-16 surrogate code unit that is not part of a well-formed pair. `JSON.parse`
 *  produces these happily from `"\ud800"`, which is how one reaches a manifest field. */
const JSONB_UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * A non-empty display string this library is willing to write into a `jsonb` column.
 *
 * THREE clauses, THREE different justifications — conflating them would be dishonest:
 *
 *  1. **`U+0000` is a hard Postgres error.** MEASURED against the Compose Postgres 17 on
 *     2026-07-26: `SELECT ('{"a":"x' || E'\\u0000' || 'y"}')::jsonb` →
 *     `ERROR: unsupported Unicode escape sequence / DETAIL:   cannot be converted to
 *     text`. A NUL surviving into this snapshot is a FAILED PUBLISH INSERT, not a
 *     cosmetic problem. Non-negotiable.
 *  2. **The rest of C0 + DEL is POLICY**, and it deliberately matches the api's
 *     `src/postgres-text.ts` rule so the two boundaries cannot disagree about what a
 *     display string may contain. None of them carries display meaning here, and one
 *     predicate beats a carve-out the next control character walks around.
 *  3. **An unpaired surrogate is refused for HONESTY, not safety** — it is not
 *     well-formed text, and accepting it would validate something no consumer can render
 *     and the driver would silently transcode.
 *
 * WHY IT IS DUPLICATED rather than imported: the api's module is a *consumer's* module
 * (this library cannot import from it), it gates REQUEST-derived strings at Fastify
 * boundaries with 400 error contracts, and this value is SERVER-built from a repo file
 * and never crosses a request boundary. Two boundaries, one rule, stated in both places
 * — if either changes, the other's tests say so, because both enumerate the class.
 */
function jsonbSafeText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !JSONB_FORBIDDEN_CONTROL_CHARS.test(v), {
      message: "must not contain control characters (tab, newline and CR excepted)",
    })
    .refine((v) => !JSONB_UNPAIRED_SURROGATE.test(v), {
      message: "must not contain an unpaired surrogate",
    });
}

/** One scene tile on the watch page's HOW IT WAS MADE grid.
 *
 *  `index` is 1-based and is the number PRINTED on the tile, so it is a display value,
 *  not an array offset. `durationSeconds` mirrors the manifest's own `positive()` number
 *  (fractional durations are real). There is NO image: the tiles are deterministic
 *  gradients derived from `index`, which is why this shape carries no asset key. */
export const GalleryMakingOfSceneSchema = z.object({
  index: z.number().int().min(1),
  name: jsonbSafeText(120),
  durationSeconds: z.number().positive(),
});
export type GalleryMakingOfScene = z.infer<typeof GalleryMakingOfSceneSchema>;

/**
 * The value stored in `GalleryItem.makingOf` — a bounded, versioned manifest snapshot.
 *
 * `version` is the literal `1` and REJECTS anything else. That is the whole point of
 * carrying it: without the literal, a v2 snapshot written by a newer API would be
 * half-read by an older reader — recognized fields parse, unrecognized ones are stripped,
 * and the page renders a confident lie. Rejecting is what lets a reader degrade honestly
 * to `null`.
 *
 * Every optional value is `T | null`, never `""` or an omitted key: "we do not have a
 * music style" and "the music style is the empty string" must not be the same wire value,
 * because one renders no chip and the other renders an empty one.
 *
 * The BOUNDS ARE ENFORCEMENT, not documentation. This snapshot is built from a manifest
 * file in a user's own repository — arbitrary, user-authored text on its way into a jsonb
 * column read by an anonymous public page. `scenes` is capped at 64 (the builder must
 * TRUNCATE, not fail), the labels at 120 characters (the builder must truncate a long
 * narrator `description` to fit — the design draws a chip, not a paragraph) and
 * `scriptureText` at 20 000 (about the longest single-chapter passage, with room to
 * spare). A snapshot that cannot satisfy this schema is dropped to `null` rather than
 * stored, so an oversized input costs a missing section, never a failed publish.
 */
export const GalleryMakingOfSchema = z.object({
  version: z.literal(1),
  capturedAt: z.iso.datetime({ offset: true }),
  scriptureText: jsonbSafeText(20_000).nullable(),
  narratorVoiceLabel: jsonbSafeText(120).nullable(),
  musicStyle: jsonbSafeText(120).nullable(),
  captionsOn: z.boolean(),
  scenes: z.array(GalleryMakingOfSceneSchema).max(64),
});
export type GalleryMakingOf = z.infer<typeof GalleryMakingOfSchema>;

/** `GET /v1/gallery/:id` — the WATCH PAGE's contract, a strict widening of the card DTO.
 *
 *  Two fields more than a card, and both are per-item costs the grid must not pay:
 *  `makingOf` is a jsonb blob nobody needs 24 of, and `publicVideoCount` is a `COUNT(*)`
 *  — 24 of those per listing page, for a number the cards never render.
 *
 *  `makingOf` is REQUIRED-BUT-NULLABLE rather than optional, so a mapper cannot forget
 *  it: omitting the key must be a validation failure, not a silently missing section. */
export const GalleryItemDetailDtoSchema = GalleryItemDtoSchema.extend({
  makingOf: GalleryMakingOfSchema.nullable(),
  owner: GalleryOwnerSchema.extend({
    /** How many PUBLIC gallery items this owner has. `unlisted` items are excluded — the
     *  count sits on a public page beside a creator's name, so counting items a visitor
     *  cannot reach would overstate them to everyone including their owner. */
    publicVideoCount: z.number().int().min(0),
  }),
});
export type GalleryItemDetailDto = z.infer<typeof GalleryItemDetailDtoSchema>;

/** `GET /v1/gallery/:id` response. A `{ item }` envelope like every sibling — never a
 *  bare item — so the response can grow a peer key without a wire break. */
export const GalleryItemDetailResponseSchema = z.object({
  item: GalleryItemDetailDtoSchema,
});
export type GalleryItemDetailResponse = z.infer<
  typeof GalleryItemDetailResponseSchema
>;

/** `GET /v1/gallery` response. Keyed envelope, never a bare array.
 *
 *  `nextCursor` is the WHOLE pagination contract: the service fetches `pageSize + 1`
 *  rows and mints a cursor only if the extra row existed, so `null` means GENUINELY
 *  EXHAUSTED — not "this page was short" — which is what lets the UI hide "Load more"
 *  honestly. There is deliberately NO `hasMore` (a second field that can disagree with
 *  `nextCursor`) and NO `total` (a `COUNT(*)` on every public listing, for a number the
 *  design never renders). The cursor is opaque: it carries ordering coordinates only —
 *  no secret and no authorization — so it is not signed, and its shape may change
 *  without a wire break. */
export const GalleryListResponseSchema = z.object({
  items: z.array(GalleryItemDtoSchema),
  nextCursor: z.string().nullable(),
});
export type GalleryListResponse = z.infer<typeof GalleryListResponseSchema>;

/** `GET /v1/gallery` querystring — `sort`, `q`, `cursor`, and nothing else.
 *
 *  There is NO client `limit`: the design names none, and an unbounded limit on a
 *  public, unauthenticated endpoint is a trivial DoS. Page size is a service constant.
 *
 *  There is NO `book` filter either (dropped 2026-07-26). The gallery is sorted and
 *  free-text searched, never filtered by book — and more fundamentally, WHICH BOOKS
 *  EXIST IS A PROPERTY OF THE TRANSLATION, with the YouVersion API as the authority on
 *  it, so a facet enumerated from a book list hardcoded in this repo was the wrong
 *  design in the first place. `scriptureBook` stays an internal derived column (see
 *  `scripture-book.ts`); it is not a query parameter.
 *
 *  `q` accepts an empty/blank value (a UI that always appends the parameter must not
 *  get a 400); the service treats blank as ABSENT — a blank `q` must never become a
 *  `%%` match-everything predicate. `q` is escaped for `LIKE` server-side.
 *
 *  `cursor` is validated by the service's cursor codec, not here: shape alone cannot
 *  tell a valid cursor from a forged one, so every cursor rejection shares ONE error
 *  path (400 `invalid_cursor`) instead of splitting between a Zod 400 and a service
 *  400. A cursor minted under a different `sort` is rejected rather than silently
 *  reset — honouring it would page a DIFFERENT ordering and skip or duplicate rows. */
export const GalleryListQuerySchema = z.object({
  sort: GallerySortSchema.default("popular"),
  q: z.string().optional(),
  cursor: z.string().optional(),
});
export type GalleryListQuery = z.infer<typeof GalleryListQuerySchema>;

/** `:id` path param for every `/v1/gallery/:id*` route (the publish route is
 *  render-scoped and reuses `RenderIdParamSchema`). */
export const GalleryIdParamSchema = z.object({
  id: z.string().min(1),
});
export type GalleryIdParam = z.infer<typeof GalleryIdParamSchema>;

/** `DELETE /v1/gallery/:id` response — `200 { ok: true }`, matching the
 *  `DELETE /v1/projects/:id` precedent rather than a 204. Deleting cascades the item's
 *  `GalleryUpvote` rows and frees the `renderJobId` unique slot, so a render can be
 *  un-published and re-published. The S3 objects are NOT deleted (that is the cleanup
 *  workflow's job). */
export const GalleryDeleteResponseSchema = z.object({
  ok: z.literal(true),
});
export type GalleryDeleteResponse = z.infer<typeof GalleryDeleteResponseSchema>;
