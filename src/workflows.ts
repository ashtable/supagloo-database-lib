import type { ProjectJobKind } from "./generated/prisma/client";

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
