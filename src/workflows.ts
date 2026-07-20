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
 * Only `scaffold` is wired to a real registered workflow today; the type is
 * extensible to the other three git-ops kinds (import_verify/commit/publish), which
 * add their entries as their workflows land (tasks 19/21/22).
 */

export const SCAFFOLD_PROJECT_WORKFLOW_NAME = "scaffoldProject" as const;
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
} as const satisfies Partial<Record<ProjectJobKind, GitOpsWorkflowTarget>>;
