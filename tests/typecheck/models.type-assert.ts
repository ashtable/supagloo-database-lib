// Type-level compile check for the Task #4 models. Compiled with
// `tsc --noEmit` by src/schema.test.ts. It proves (at the type level) that the
// five model types are exported and shaped as designed, and — via the
// `@ts-expect-error` on `.token` — that GithubConnection exposes NO token field
// (a compile-time twin of the runtime "no token column" assertion). If any
// `@ts-expect-error` stops describing a real error (e.g. someone adds a token
// field, or widens youversionUserId), tsc reports the unused directive and the
// check fails.

import type {
  GithubConnection,
  GlooConnection,
  OpenRouterConnection,
  Session,
  User,
} from "../../src/index";

// A fully-typed User row — asserts the scalar shape, including the nullable
// onboardingCompletedAt and the Date/string field types.
export const user: User = {
  id: "usr_1",
  youversionUserId: "yv_1",
  displayName: "Ash",
  email: "ash@example.com",
  avatarInitials: "AS",
  firstSignInAt: new Date(),
  onboardingCompletedAt: null,
  lastSeenAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// youversionUserId must be a string, not a number.
export const badUser: User = {
  ...user,
  // @ts-expect-error youversionUserId is a string
  youversionUserId: 123,
};

export function fieldRefs(
  session: Session,
  github: GithubConnection,
  openrouter: OpenRouterConnection,
  gloo: GlooConnection,
): string[] {
  return [
    session.tokenHash,
    github.installationId,
    github.githubLogin,
    openrouter.apiKeyCiphertext,
    openrouter.keyLast4,
    gloo.clientId,
    gloo.clientSecretCiphertext,
  ];
}

// GithubConnection must NOT expose any long-lived token field (§2.3).
export function noTokenColumn(github: GithubConnection): unknown {
  // @ts-expect-error GithubConnection has no `token` field — only installationId
  return github.token;
}

// ---------------------------------------------------------------------------
// Task #5 model + enum type-level fixtures (design-delta §2.6–2.9). Compiled by
// src/schema.test.ts's tsc check. Proves the 6 new model types are exported and
// shaped as designed, the 9 enums are exported as value+type, and — via the
// `@ts-expect-error` block at the bottom — that NO Composition/Scene type exists
// in the generated client (composition is a repo manifest, not Postgres).
// ---------------------------------------------------------------------------

import type {
  AiGeneration,
  GalleryItem,
  GalleryUpvote,
  Project,
  ProjectJob,
  ProjectVersion,
  RenderJob,
} from "../../src/index";
import {
  AiGenerationKind,
  AiProvider,
  GalleryVisibility,
  JobStatus,
  ProjectCreatedFrom,
  ProjectJobKind,
  ProjectVersionState,
  RenderStatus,
  RepoVisibility,
} from "../../src/index";
// Namespace import used only for the Composition/Scene absence assertions.
import type * as DbLib from "../../src/index";

export const project: Project = {
  id: "prj_1",
  slug: "psalm-121",
  ownerId: "usr_1",
  name: "Psalm 121",
  repoOwner: "ashtable",
  repoName: "psalm-121",
  repoVisibility: RepoVisibility.private,
  createdFrom: ProjectCreatedFrom.blank,
  currentBranch: "v0.0.1",
  thumbnailAssetKey: null,
  lastRenderJobId: null,
  lastOpenedAt: new Date(),
  createdAt: new Date(),
  deletedAt: null,
};

// lastRenderJobId is a denormalized nullable string pointer, NOT a relation.
export const badProject: Project = {
  ...project,
  // @ts-expect-error lastRenderJobId is `string | null`, never a number
  lastRenderJobId: 123,
};

export const version: ProjectVersion = {
  id: "ver_1",
  projectId: "prj_1",
  semver: "0.0.0",
  branchName: "v0.0.0",
  state: ProjectVersionState.base,
  commitMessage: null,
  autoSummary: null,
  changedFiles: ["M src/scenes/Shelter.tsx"],
  headCommitSha: null,
  prNumber: null,
  prUrl: null,
  publishedAt: null,
};

export const renderJob: RenderJob = {
  id: "rj_1",
  projectId: "prj_1",
  versionId: "ver_1",
  userId: "usr_1",
  status: RenderStatus.queued,
  framesDone: 0,
  framesTotal: 0,
  width: 1080,
  height: 1920,
  fps: 30,
  aspectRatio: "9:16",
  codec: "h264",
  outputAssetKey: null,
  thumbnailAssetKey: null,
  runInBackground: false,
  error: null,
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
};

export const aiGeneration: AiGeneration = {
  id: "aig_1",
  userId: "usr_1",
  projectId: null,
  sceneId: null,
  kind: AiGenerationKind.script,
  provider: AiProvider.openrouter,
  model: "some/model",
  input: { passage: "Genesis 1:1" },
  status: JobStatus.queued,
  providerJobId: null,
  resultJson: null,
  resultAssetKey: null,
  error: null,
  tokenUsage: null,
  createdAt: new Date(),
  completedAt: null,
};

export const galleryItem: GalleryItem = {
  id: "gi_1",
  renderJobId: "rj_1",
  projectId: "prj_1",
  ownerId: "usr_1",
  title: "Let There Be Light",
  description: "Genesis 1",
  scriptureReference: "GENESIS 1:1-4",
  translation: "KJV",
  scriptureBook: "GEN",
  durationSeconds: 30,
  videoAssetKey: "renders/rj_1/output.mp4",
  thumbnailAssetKey: "renders/rj_1/thumb.jpg",
  visibility: GalleryVisibility.public,
  publishedAt: new Date(),
  upvoteCount: 0,
  viewCount: 0,
};

export const galleryUpvote: GalleryUpvote = {
  id: "gu_1",
  userId: "usr_1",
  galleryItemId: "gi_1",
  createdAt: new Date(),
};

export const projectJob: ProjectJob = {
  id: "pj_1",
  projectId: "prj_1",
  userId: "usr_1",
  versionId: null,
  kind: ProjectJobKind.scaffold,
  status: JobStatus.queued,
  stages: [{ key: "clone", label: "Clone", state: "pending" }],
  error: null,
  createdAt: new Date(),
  completedAt: null,
};

// Every enum member is assignable to its own type — proves the enum unions.
export const renderStatuses: RenderStatus[] = [
  RenderStatus.queued,
  RenderStatus.bundling,
  RenderStatus.synthesizing,
  RenderStatus.encoding,
  RenderStatus.uploading,
  RenderStatus.completed,
  RenderStatus.failed,
  RenderStatus.canceled,
];
export const jobStatuses: JobStatus[] = [
  JobStatus.queued,
  JobStatus.running,
  JobStatus.succeeded,
  JobStatus.failed,
  JobStatus.canceled,
];

// Binding constraint (composition-source-of-truth-in-repo): the generated client
// must expose NO Composition/Scene model type. If either is ever added, the
// corresponding `@ts-expect-error` becomes unused and tsc fails the build.
// @ts-expect-error — no Composition model type exists (composition lives in the repo manifest)
export type _NoComposition = DbLib.Composition;
// @ts-expect-error — no Scene model type exists (scenes are manifest-only, never persisted)
export type _NoScene = DbLib.Scene;
