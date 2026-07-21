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
});
export type CreateRepoRequest = z.infer<typeof CreateRepoRequestSchema>;

// ===========================================================================
// Commit-version WIRE + enqueue DTOs (Task #21 — design-delta §7 workflow 3 / §8)
// ---------------------------------------------------------------------------
// The API<->BFF contract for `POST /v1/projects/:id/commit` (create a `commit`
// ProjectJob, then DBOSClient.enqueue(commitVersion)) and the API<->DBOS enqueue payload.
// The request carries the EDITED manifest + a commit message; the manifest is validated
// against `ProjectManifestSchema` (whose `TranslationSchema` is KJV/BSB-only, so a
// non-KJV/BSB manifest is rejected at the boundary). The payload additionally carries the
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
