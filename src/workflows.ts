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
 * Task #30 wires the two TEXT kinds — `storyboard` (full scene breakdown) and `script`
 * (single-scene text) — both to the one `generateScript` workflow, which selects the target
 * Zod schema by the request row's `kind`. The media kinds (image/narration/music/video) land
 * on their own workflows in tasks #32–34 and extend this table then.
 */
export const GENERATE_SCRIPT_WORKFLOW_NAME = "generateScript" as const;
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
