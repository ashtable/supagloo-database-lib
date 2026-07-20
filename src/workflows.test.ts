import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  GIT_OPS_QUEUE_NAME,
  GIT_OPS_WORKFLOW_BY_KIND,
  IMPORT_PROJECT_WORKFLOW_NAME,
  SCAFFOLD_PROJECT_WORKFLOW_NAME,
} from "./workflows";

// Task #18: the static kind→workflow routing contract, promoted to db-lib so the
// API's enqueue lookup table and the dbos static registry import the SAME constants
// (the "shared fixture" the registry unit tests pin against). Only `scaffold` is
// wired to a real registered workflow today; the table's TYPE is extensible to the
// other git-ops kinds (import_verify/commit/publish) as their workflows land.

describe("Task #18 workflows — shared name/queue constants", () => {
  it("pins the scaffold workflow name and the git-ops queue name", () => {
    expect(SCAFFOLD_PROJECT_WORKFLOW_NAME).toBe("scaffoldProject");
    expect(GIT_OPS_QUEUE_NAME).toBe("git-ops");
  });
});

describe("Task #19 workflows — import workflow name", () => {
  it("pins the import workflow name", () => {
    expect(IMPORT_PROJECT_WORKFLOW_NAME).toBe("importProject");
  });
});

describe("Task #18/19 workflows — GIT_OPS_WORKFLOW_BY_KIND", () => {
  it("maps scaffold to the scaffold workflow on the git-ops queue", () => {
    expect(GIT_OPS_WORKFLOW_BY_KIND.scaffold).toEqual({
      workflowName: SCAFFOLD_PROJECT_WORKFLOW_NAME,
      queueName: GIT_OPS_QUEUE_NAME,
    });
  });

  it("maps import_verify to the import workflow on the git-ops queue (Task #19)", () => {
    expect(GIT_OPS_WORKFLOW_BY_KIND.import_verify).toEqual({
      workflowName: IMPORT_PROJECT_WORKFLOW_NAME,
      queueName: GIT_OPS_QUEUE_NAME,
    });
  });

  it("covers exactly the workflow kinds wired so far (scaffold + import_verify)", () => {
    expect(Object.keys(GIT_OPS_WORKFLOW_BY_KIND)).toEqual([
      "scaffold",
      "import_verify",
    ]);
  });
});

describe("Task #18/19 workflows — barrel exports", () => {
  it("re-exports the routing constants from the package entry", () => {
    expect(DbLib.SCAFFOLD_PROJECT_WORKFLOW_NAME).toBe("scaffoldProject");
    expect(DbLib.IMPORT_PROJECT_WORKFLOW_NAME).toBe("importProject");
    expect(DbLib.GIT_OPS_QUEUE_NAME).toBe("git-ops");
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.scaffold.workflowName).toBe(
      "scaffoldProject",
    );
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.import_verify?.workflowName).toBe(
      "importProject",
    );
  });
});
