import { z } from "zod";

/**
 * The `ProjectJob.stages` contract — the SHARED API↔DBOS progress-log format
 * (design-delta §2.9/§6b/§7).
 *
 * `ProjectJob.stages` is an untyped Prisma `Json` column holding an array of
 * `{ key, label, state }`. The API SEEDS it at enqueue time (`buildInitialStages`);
 * the DBOS workflow UPDATES each entry by `key` as its steps complete. Promoted here
 * to database-lib (from the task-17 dbos-local home) so both services import ONE
 * source of truth — the API can never seed a stage shape the worker won't recognize.
 *
 * Each workflow keeps its OWN catalogue (the ordered `{key,label}` list); task 18
 * promotes the scaffold catalogue. Later git-ops workflows (import_verify/commit/
 * publish) add their catalogues here as they land.
 */

export const STAGE_STATES = ["pending", "running", "done", "failed"] as const;
export type StageState = (typeof STAGE_STATES)[number];

export interface JobStage {
  key: string;
  label: string;
  state: StageState;
}

export const JobStageSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  state: z.enum(STAGE_STATES),
});
export const JobStagesSchema = z.array(JobStageSchema);

/** One entry in a workflow's ordered stage catalogue (label + step key, no state). */
export interface StageCatalogueEntry {
  key: string;
  label: string;
}

/**
 * A fresh stage log with every catalogue entry `pending` — what the API seeds into
 * `ProjectJob.stages` at enqueue time. Returns a NEW array (callers may mutate/seed
 * independently).
 */
export function buildInitialStages(
  catalogue: readonly StageCatalogueEntry[],
): JobStage[] {
  return catalogue.map((s) => ({ key: s.key, label: s.label, state: "pending" }));
}

/**
 * The eight scaffold steps, row-for-row (design-delta §6b/§7). Each `key` is EXACTLY
 * the corresponding `scaffoldProjectWorkflow` `DBOS.runStep` name, so the stage log
 * and the step checkpoints line up one-to-one.
 */
export const SCAFFOLD_STAGES: readonly StageCatalogueEntry[] = [
  { key: "mintInstallationToken", label: "Authenticating with GitHub" },
  { key: "ensureRepoAccessible", label: "Verifying repository access" },
  { key: "cloneToWorkspace", label: "Cloning repository" },
  { key: "writeRemotionScaffold", label: "Writing project scaffold" },
  { key: "commitBaseVersion", label: "Committing base version (v0.0.0)" },
  { key: "pushOpenMergeBasePr", label: "Opening & merging base pull request" },
  { key: "cutWorkingBranch", label: "Cutting working branch (v0.0.1)" },
  { key: "finalizeRecords", label: "Finalizing project records" },
] as const;
