// Type-level compile check for the Task #7 domain Zod schemas (design-delta §2.11).
// Compiled with `tsc --noEmit` by src/schemas.test.ts. It proves (at the type
// level) that the inferred types are exported and shaped as designed, and — via the
// `@ts-expect-error` directives — that the literal constraints (Translation union,
// manifestVersion literal, required codec) are enforced by the TYPES, not only at
// runtime. If any `@ts-expect-error` stops describing a real error (someone widens a
// type), tsc reports the unused directive and this check fails.

import type {
  CompositionSpec,
  CreateRenderRequest,
  GalleryItemDto,
  GalleryListResponse,
  GallerySort,
  GeneratedStoryboard,
  ManifestScene,
  MusicSpec,
  NarrationSpec,
  ProjectManifest,
  PublishGalleryItemRequest,
  RenderJobDto,
  RenderOutputSpec,
  SceneVisualPrompt,
  ScriptureBook,
  Translation,
  VoiceDescriptor,
} from "../../src/index";
import {
  SCRIPTURE_BOOKS,
  deriveScriptureBook,
  isScriptureBookCode,
} from "../../src/index";

// §9-Q10 (broadened): Translation is a non-empty string, not a fixed enum — the licensed
// set is validated at runtime against the live YouVersion collection, so any abbreviation
// compiles (KJV/BSB stay the default; NIV/ESV/… are equally valid types).
const translation: Translation = "KJV";
const nivTranslation: Translation = "NIV";
// @ts-expect-error Translation is a string — never a non-string literal
const badTranslation: Translation = 5;
void nivTranslation;

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

// ── Task #37 render wire DTOs ────────────────────────────────────────────────

export const createRender: CreateRenderRequest = {
  versionId: "pv_1",
  outputSpec: render,
  runInBackground: false,
};

export const renderDto: RenderJobDto = {
  id: "rj_1",
  projectId: "prj_1",
  versionId: "pv_1",
  status: "encoding",
  framesDone: 612,
  framesTotal: 840,
  outputSpec: render,
  outputAssetKey: null,
  thumbnailAssetKey: null,
  runInBackground: false,
  error: null,
  createdAt: "2026-07-24T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

// `status` is the closed RenderStatus union, not a free string.
// @ts-expect-error "rendering" is not a RenderStatus
export const badRenderDto: RenderJobDto = { ...renderDto, status: "rendering" };

// ── Tasks #39/#40 gallery wire DTOs + the shared book deriver ────────────────

export const gallerySort: GallerySort = "trending";
// @ts-expect-error "hot" is not a GallerySort
export const badGallerySort: GallerySort = "hot";

export const galleryItem: GalleryItemDto = {
  id: "gi_1",
  renderJobId: "rj_1",
  projectId: "prj_1",
  title: "In the beginning",
  description: "",
  scriptureReference: "GENESIS 1:1-4",
  scriptureBook: "GEN",
  translation: "KJV",
  durationSeconds: 42,
  visibility: "public",
  publishedAt: "2026-07-25T10:00:00.000Z",
  upvoteCount: 7,
  thumbnailUrl: null,
  rank: null, // non-null ONLY under sort=popular
  viewerHasUpvoted: false,
  owner: { displayName: "Mary K", avatarInitials: "MK" },
};

// `visibility` is the closed GalleryVisibility union, not a free string.
// @ts-expect-error "private" is not a GalleryVisibility
export const badGalleryItem: GalleryItemDto = { ...galleryItem, visibility: "private" };

// REQUIRED-NESS at the TYPE level. The positive literal above is fully populated, so it
// keeps compiling if a field is loosened to `.optional()` — the exact mutation that lets a
// handler with an incomplete Prisma `select` render `undefined` on a public card. Each
// directive below fails as UNUSED the moment its field stops being required, so the type
// lane catches the loosening too, not only the runtime omit-loop in src/schemas.test.ts.
// The four chosen are the ones a `select` most plausibly drops.
const { scriptureBook: _dropBook, ...itemNoBook } = galleryItem;
// @ts-expect-error scriptureBook is REQUIRED — it drives the public book facet
export const galleryItemNoBook: GalleryItemDto = itemNoBook;

const { publishedAt: _dropPublishedAt, ...itemNoPublishedAt } = galleryItem;
// @ts-expect-error publishedAt is REQUIRED — the newest-sort key and the card's date
export const galleryItemNoPublishedAt: GalleryItemDto = itemNoPublishedAt;

const { thumbnailUrl: _dropThumb, ...itemNoThumb } = galleryItem;
// @ts-expect-error thumbnailUrl is nullable but NOT optional — the key must be present
export const galleryItemNoThumb: GalleryItemDto = itemNoThumb;

const { rank: _dropRank, ...itemNoRank } = galleryItem;
// @ts-expect-error rank is nullable but NOT optional — null means "not the popular sort"
export const galleryItemNoRank: GalleryItemDto = itemNoRank;

export const galleryList: GalleryListResponse = {
  items: [galleryItem],
  nextCursor: null, // null == genuinely exhausted, not "this page was short"
};

// The listing is a keyed envelope, never a bare array.
// @ts-expect-error a bare array is not a GalleryListResponse
export const badGalleryList: GalleryListResponse = [galleryItem];

export const publishGallery: PublishGalleryItemRequest = {
  title: "In the beginning",
  description: "",
  scriptureReference: "GENESIS 1:1-4",
  translation: "KJV",
  visibility: "public",
};

// `scriptureBook` is derived server-side from the reference — never client-supplied.
export const badPublishGallery: PublishGalleryItemRequest = {
  ...publishGallery,
  // @ts-expect-error scriptureBook is not part of the publish request
  scriptureBook: "GEN",
};

export const firstBook: ScriptureBook = SCRIPTURE_BOOKS[0];
export const isCode: boolean = isScriptureBookCode("1CO");
// The deriver returns `string | null` at the TYPE level — the null branch is the
// publish 422, so a caller cannot forget to handle it.
export const derivedBook: string | null = deriveScriptureBook("1 Corinthians 13");
// @ts-expect-error deriveScriptureBook may return null
export const badDerivedBook: string = deriveScriptureBook("a poem");
