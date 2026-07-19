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

/** `POST /v1/auth/youversion` request: the YouVersion access token the browser
 *  obtained client-side and the BFF forwards for server-side verification. */
export const YouVersionSignInRequestSchema = z.object({
  accessToken: z.string().min(1),
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

/** One repo in the live listing (design-delta §8, wizards 12b/13a). `empty` is
 *  derived by the API from GitHub's `size === 0` (a repo with no commits). */
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
