import type {
  AiGenerationKind,
  AiProvider,
  ProjectJobKind,
} from "./generated/prisma/client";

/**
 * The static `kind → workflow` routing contract for git-ops ProjectJobs
 * (design-delta §5.1/§7), promoted here to database-lib so BOTH the API (its enqueue
 * lookup table) and the DBOS worker (its static registry) import the SAME constants.
 * This is what makes the "shared fixture" real — the dbos registry unit test and the
 * API workflow-lookup unit test both pin against these values, so the two services
 * can never disagree on a workflow name or queue.
 *
 * HARD CONSTRAINT (memory dbos-static-workflows-and-enqueue-pattern): workflows are
 * statically registered only. This table is fixed source data — nothing is
 * constructed at runtime.
 *
 * All four git-ops kinds (scaffold/import_verify/commit/publish) are now wired to real
 * registered workflows (tasks 17/19/21/22).
 */

export const SCAFFOLD_PROJECT_WORKFLOW_NAME = "scaffoldProject" as const;
export const IMPORT_PROJECT_WORKFLOW_NAME = "importProject" as const;
export const COMMIT_VERSION_WORKFLOW_NAME = "commitVersion" as const;
export const PUBLISH_VERSION_WORKFLOW_NAME = "publishVersion" as const;
export const GIT_OPS_QUEUE_NAME = "git-ops" as const;

export interface GitOpsWorkflowTarget {
  workflowName: string;
  queueName: string;
}

export const GIT_OPS_WORKFLOW_BY_KIND = {
  scaffold: {
    workflowName: SCAFFOLD_PROJECT_WORKFLOW_NAME,
    queueName: GIT_OPS_QUEUE_NAME,
  },
  // Task #19: the import-verify workflow. Rides the SAME `git-ops` queue; the DBOS
  // registry (`importProject`) and the API's enqueue lookup both read this entry, so
  // they can never disagree on the import workflow name. `commit`/`publish` land in
  // tasks 21/22.
  import_verify: {
    workflowName: IMPORT_PROJECT_WORKFLOW_NAME,
    queueName: GIT_OPS_QUEUE_NAME,
  },
  // Task #21: the commit-version workflow. Rides the SAME `git-ops` queue; the DBOS
  // registry (`commitVersion`) and the API's enqueue lookup both read this entry, so
  // they can never disagree on the commit workflow name.
  commit: {
    workflowName: COMMIT_VERSION_WORKFLOW_NAME,
    queueName: GIT_OPS_QUEUE_NAME,
  },
  // Task #22: the publish-version workflow (merge the working branch to main, tag the
  // release, cut the next working branch). Rides the SAME `git-ops` queue; the DBOS
  // registry (`publishVersion`) and the API's enqueue lookup both read this entry. This
  // completes the four git-ops kinds.
  publish: {
    workflowName: PUBLISH_VERSION_WORKFLOW_NAME,
    queueName: GIT_OPS_QUEUE_NAME,
  },
} as const satisfies Partial<Record<ProjectJobKind, GitOpsWorkflowTarget>>;

/**
 * The static `AiGenerationKind → workflow` routing for the `ai-generation` queue
 * (design-delta §5.1/§7 workflow 5). Same shared-constant discipline as the git-ops table:
 * the API's enqueue lookup (#31/#35) and the DBOS static registry import the SAME values, so
 * they can never disagree on the generation workflow name/queue.
 *
 * Task #30 wired the two TEXT kinds — `storyboard` (full scene breakdown) and `script`
 * (single-scene text) — both to the one `generateScript` workflow, which selects the target
 * Zod schema by the request row's `kind`. The media kinds landed on their own workflows in
 * tasks #32–34 (`generateImage`, `generateAudio` for narration+music, `generateVideo`). As of
 * #34 this table is COMPLETE — every `AiGenerationKind` routes to a real registered workflow.
 */
export const GENERATE_SCRIPT_WORKFLOW_NAME = "generateScript" as const;
// Task #32: the image-generation workflow (openrouter-only per §9-Q2). Same
// shared-constant discipline — the API enqueues to this exact name on the ai-generation
// queue, the DBOS static registry pins the same value. narration/music/video land on
// their own workflows in #33/#34 and extend the map then.
export const GENERATE_IMAGE_WORKFLOW_NAME = "generateImage" as const;
// Task #33: the audio-generation workflow — ONE workflow covering BOTH audio kinds
// (`narration` TTS + `music`), openrouter-only per §9-Q2, dispatching by the row's kind
// (the generateScript storyboard/script precedent). Same shared-constant discipline: the
// API enqueues to this exact name on the ai-generation queue, the DBOS static registry
// pins the same value.
export const GENERATE_AUDIO_WORKFLOW_NAME = "generateAudio" as const;
// Task #34: the video-generation workflow — OpenRouter's async video-job API (submit → poll
// with durable ~30s sleeps → download → upload). openrouter-only per §9-Q2. Same
// shared-constant discipline. This wires the LAST AI-generation kind — every kind now routes
// to a real registered workflow.
export const GENERATE_VIDEO_WORKFLOW_NAME = "generateVideo" as const;
export const AI_GENERATION_QUEUE_NAME = "ai-generation" as const;

export interface AiGenerationWorkflowTarget {
  workflowName: string;
  queueName: string;
}

export const AI_GENERATION_WORKFLOW_BY_KIND = {
  storyboard: {
    workflowName: GENERATE_SCRIPT_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
  script: {
    workflowName: GENERATE_SCRIPT_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
  // Task #32: image → generateImage on the ai-generation queue. `image` is openrouter-only
  // (AI_PROVIDERS_BY_KIND.image), enforced at enqueue (422) BEFORE this routing lookup.
  image: {
    workflowName: GENERATE_IMAGE_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
  // Task #33: BOTH audio kinds (narration + music) → the one generateAudio workflow, which
  // dispatches by the row's kind (like generateScript for storyboard/script). Both are
  // openrouter-only (AI_PROVIDERS_BY_KIND), enforced at enqueue (422) BEFORE this lookup.
  // Only `video` stays unwired (task #34).
  narration: {
    workflowName: GENERATE_AUDIO_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
  music: {
    workflowName: GENERATE_AUDIO_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
  // Task #34: video → generateVideo on the ai-generation queue (async video-job workflow).
  // `video` is openrouter-only (AI_PROVIDERS_BY_KIND.video), enforced at enqueue (422) BEFORE
  // this routing lookup. This is the LAST kind — the map now covers all six AiGenerationKinds.
  video: {
    workflowName: GENERATE_VIDEO_WORKFLOW_NAME,
    queueName: AI_GENERATION_QUEUE_NAME,
  },
} as const satisfies Partial<Record<AiGenerationKind, AiGenerationWorkflowTarget>>;

/**
 * The kind→provider COMPATIBILITY MATRIX (design-delta §7 "Provider call patterns",
 * §9-Q2), promoted here as the single shared constant the design mandates ("defined once
 * as a shared database-lib constant and enforced (422) at POST /v1/ai/generations BEFORE
 * any row or workflow is created"). The API's create-generation service (#31) validates
 * `{kind, provider}` against this and rejects out-of-matrix pairs with 422.
 *
 * The two TEXT kinds (`storyboard`/`script`) can run on EITHER provider — both expose a
 * chat/structured-output surface. The four MEDIA kinds (`image`/`narration`/`music`/
 * `video`) are `openrouter` ONLY: Gloo has no media modalities (§9-Q2). Unlike the
 * partial workflow table above, this is a COMPLETE record — the matrix is fully known
 * today even though the media WORKFLOWS land in #32–34 (a matrix-valid pair whose
 * workflow is not yet registered is a DIFFERENT, later failure mode, not a matrix
 * rejection).
 */
export const AI_PROVIDERS_BY_KIND = {
  storyboard: ["gloo", "openrouter"],
  script: ["gloo", "openrouter"],
  image: ["openrouter"],
  narration: ["openrouter"],
  music: ["openrouter"],
  video: ["openrouter"],
} as const satisfies Record<AiGenerationKind, readonly AiProvider[]>;

/** True iff `provider` may serve `kind` per {@link AI_PROVIDERS_BY_KIND}. The API's
 *  create path calls this and 422s a `false` result before creating any row/workflow. */
export function isProviderCompatible(
  kind: AiGenerationKind,
  provider: AiProvider,
): boolean {
  return (AI_PROVIDERS_BY_KIND[kind] as readonly AiProvider[]).includes(
    provider,
  );
}

/**
 * The `render` workflow's routing constants (design-delta §6c / §7 workflow 9).
 *
 * Unlike the git-ops and ai-generation tables above, there is no kind→target MAP here:
 * `renderWorkflow` is the ONLY workflow on the dedicated `render` queue, and a render
 * request has no "kind" to dispatch on — the RenderJob row carries everything (project,
 * version, output spec). So the whole routing contract is one target object.
 *
 * The queue is deliberately its own, at `workerConcurrency: 1` in the dbos registry:
 * Remotion drives a headless Chromium plus an FFmpeg encode, which is far too heavy to
 * share a worker slot with the light git-ops/ai-generation work (§9-Q8; real sizing
 * validation is deferred to the load-testing task 45).
 *
 * Same shared-constant discipline as everything else in this file: the dbos static
 * registry (task 36) and the API's render-enqueue path (task 37) import these SAME
 * values, so the worker and the enqueuer can never disagree on a name or a queue.
 */
export const RENDER_WORKFLOW_NAME = "render" as const;
export const RENDER_QUEUE_NAME = "render" as const;

export interface RenderWorkflowTarget {
  workflowName: string;
  queueName: string;
}

/** The single enqueue target for a render (`DBOSClient.enqueue`, `workflowID = renderJobId`). */
export const RENDER_WORKFLOW_TARGET = {
  workflowName: RENDER_WORKFLOW_NAME,
  queueName: RENDER_QUEUE_NAME,
} as const satisfies RenderWorkflowTarget;

/**
 * The maintenance janitor's routing constants (task #42, design-delta §7 workflow 10).
 *
 * `cleanupOrphanedAssetsWorkflow` deletes the S3 objects of failed/canceled jobs past a
 * retention window and purges `Session` rows past `expiresAt`. It is the ONLY S3 delete
 * path in the whole design.
 *
 * It differs from every other entry in this file in one way that matters: it is never
 * enqueued from an HTTP request. There is no `kind` to dispatch on and no API-side
 * lookup table — the dbos worker registers it statically and DBOS's own scheduler fires
 * it. So there is deliberately no kind→target MAP and no `*_WORKFLOW_TARGET` object
 * here; adding one would imply a caller can trigger a destructive sweep on demand.
 *
 * The name still belongs in this shared file for the same reason all the others do: the
 * dbos static registry pins `WORKFLOW_NAMES.cleanupOrphanedAssets` against this exact
 * constant, so the registry, the scheduler registration and any operator-facing
 * `listWorkflows` filter can never disagree on the string.
 *
 * `maintenance` is its OWN queue, not a lane on an existing one. Sharing `render` would
 * consume the single render worker slot (`workerConcurrency: 1`) and stall a user-visible
 * render behind a janitor; sharing `git-ops`/`ai-generation` would take a slot a user
 * request is waiting on.
 */
export const CLEANUP_ORPHANED_ASSETS_WORKFLOW_NAME =
  "cleanupOrphanedAssets" as const;
export const MAINTENANCE_QUEUE_NAME = "maintenance" as const;
