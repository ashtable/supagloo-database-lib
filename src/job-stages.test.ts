import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  IMPORT_STAGES,
  SCAFFOLD_STAGES,
  STAGE_STATES,
  buildInitialStages,
  JobStageSchema,
  JobStagesSchema,
} from "./job-stages";

// Task #18: the ProjectJob.stages contract, promoted to db-lib as the SHARED
// API↔DBOS contract. The API seeds `buildInitialStages(SCAFFOLD_STAGES)` at enqueue
// time; the dbos scaffold workflow reads/updates the same catalogue — so both must
// import ONE source of truth. DB-free — pure data + Zod.

describe("Task #18 job-stages — SCAFFOLD_STAGES catalogue", () => {
  it("lists the eight scaffold steps row-for-row, in order, each with a label", () => {
    expect(SCAFFOLD_STAGES.map((s) => s.key)).toEqual([
      "mintInstallationToken",
      "ensureRepoAccessible",
      "cloneToWorkspace",
      "writeRemotionScaffold",
      "commitBaseVersion",
      "pushOpenMergeBasePr",
      "cutWorkingBranch",
      "finalizeRecords",
    ]);
    for (const stage of SCAFFOLD_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Task #19 job-stages — IMPORT_STAGES catalogue", () => {
  it("lists the six import steps row-for-row, in order, each with a label", () => {
    expect(IMPORT_STAGES.map((s) => s.key)).toEqual([
      "mintInstallationToken",
      "cloneRepo",
      "verifySupaglooProject",
      "resolveLatestVersionBranch",
      "parseManifest",
      "finalizeRecords",
    ]);
    for (const stage of IMPORT_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });

  it("seeds every import stage pending and round-trips the schema", () => {
    const stages = buildInitialStages(IMPORT_STAGES);
    expect(stages).toHaveLength(IMPORT_STAGES.length);
    expect(stages.every((s) => s.state === "pending")).toBe(true);
    expect(stages.map((s) => s.key)).toEqual(IMPORT_STAGES.map((s) => s.key));
    expect(() => JobStagesSchema.parse(stages)).not.toThrow();
  });
});

describe("Task #18 job-stages — buildInitialStages + schema", () => {
  it("seeds every catalogue entry pending and round-trips the schema", () => {
    const stages = buildInitialStages(SCAFFOLD_STAGES);
    expect(stages).toHaveLength(SCAFFOLD_STAGES.length);
    expect(stages.every((s) => s.state === "pending")).toBe(true);
    expect(stages.map((s) => s.key)).toEqual(SCAFFOLD_STAGES.map((s) => s.key));
    expect(() => JobStagesSchema.parse(stages)).not.toThrow();
  });

  it("returns a fresh array (callers may seed independently)", () => {
    expect(buildInitialStages(SCAFFOLD_STAGES)).not.toBe(
      buildInitialStages(SCAFFOLD_STAGES),
    );
  });

  it("pins the four stage states and rejects an unknown state", () => {
    expect([...STAGE_STATES]).toEqual(["pending", "running", "done", "failed"]);
    expect(
      JobStageSchema.safeParse({ key: "k", label: "L", state: "pending" }).success,
    ).toBe(true);
    expect(
      JobStageSchema.safeParse({ key: "k", label: "L", state: "bogus" }).success,
    ).toBe(false);
    expect(JobStageSchema.safeParse({ key: "", label: "L", state: "done" }).success).toBe(
      false,
    );
  });
});

describe("Task #18/19 job-stages — barrel exports", () => {
  it("re-exports the stage contract from the package entry", () => {
    expect(Array.isArray(DbLib.SCAFFOLD_STAGES)).toBe(true);
    expect(Array.isArray(DbLib.IMPORT_STAGES)).toBe(true);
    expect(typeof DbLib.buildInitialStages).toBe("function");
    expect(typeof DbLib.JobStageSchema?.safeParse).toBe("function");
  });
});
