import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import {
  AI_GENERATION_QUEUE_NAME,
  AI_GENERATION_WORKFLOW_BY_KIND,
  COMMIT_VERSION_WORKFLOW_NAME,
  GENERATE_IMAGE_WORKFLOW_NAME,
  GENERATE_SCRIPT_WORKFLOW_NAME,
  GIT_OPS_QUEUE_NAME,
  GIT_OPS_WORKFLOW_BY_KIND,
  IMPORT_PROJECT_WORKFLOW_NAME,
  PUBLISH_VERSION_WORKFLOW_NAME,
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

describe("Task #21 workflows — commit workflow name", () => {
  it("pins the commit workflow name", () => {
    expect(COMMIT_VERSION_WORKFLOW_NAME).toBe("commitVersion");
  });
});

describe("Task #22 workflows — publish workflow name", () => {
  it("pins the publish workflow name", () => {
    expect(PUBLISH_VERSION_WORKFLOW_NAME).toBe("publishVersion");
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

  it("maps commit to the commit workflow on the git-ops queue (Task #21)", () => {
    expect(GIT_OPS_WORKFLOW_BY_KIND.commit).toEqual({
      workflowName: COMMIT_VERSION_WORKFLOW_NAME,
      queueName: GIT_OPS_QUEUE_NAME,
    });
  });

  it("maps publish to the publish workflow on the git-ops queue (Task #22)", () => {
    expect(GIT_OPS_WORKFLOW_BY_KIND.publish).toEqual({
      workflowName: PUBLISH_VERSION_WORKFLOW_NAME,
      queueName: GIT_OPS_QUEUE_NAME,
    });
  });

  it("covers exactly the four git-ops kinds now wired (scaffold + import_verify + commit + publish)", () => {
    expect(Object.keys(GIT_OPS_WORKFLOW_BY_KIND)).toEqual([
      "scaffold",
      "import_verify",
      "commit",
      "publish",
    ]);
  });
});

describe("Task #30 workflows — generateScript name + ai-generation queue", () => {
  it("pins the generate-script workflow name and the ai-generation queue name", () => {
    expect(GENERATE_SCRIPT_WORKFLOW_NAME).toBe("generateScript");
    expect(AI_GENERATION_QUEUE_NAME).toBe("ai-generation");
  });

  it("routes both text kinds (storyboard + script) to generateScript on ai-generation", () => {
    expect(AI_GENERATION_WORKFLOW_BY_KIND.storyboard).toEqual({
      workflowName: GENERATE_SCRIPT_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
    expect(AI_GENERATION_WORKFLOW_BY_KIND.script).toEqual({
      workflowName: GENERATE_SCRIPT_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
  });

  it("covers the two text kinds + image now wired (narration/music/video land in #33–34)", () => {
    expect(Object.keys(AI_GENERATION_WORKFLOW_BY_KIND).sort()).toEqual([
      "image",
      "script",
      "storyboard",
    ]);
  });
});

describe("Task #32 workflows — generateImage name + ai-generation queue", () => {
  it("pins the generate-image workflow name", () => {
    expect(GENERATE_IMAGE_WORKFLOW_NAME).toBe("generateImage");
  });

  it("routes the image kind to generateImage on the ai-generation queue", () => {
    expect(AI_GENERATION_WORKFLOW_BY_KIND.image).toEqual({
      workflowName: GENERATE_IMAGE_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
  });

  it("re-exports the generate-image name from the barrel", () => {
    expect(DbLib.GENERATE_IMAGE_WORKFLOW_NAME).toBe("generateImage");
  });
});

describe("Task #18/19/21/22 workflows — barrel exports", () => {
  it("re-exports the routing constants from the package entry", () => {
    expect(DbLib.SCAFFOLD_PROJECT_WORKFLOW_NAME).toBe("scaffoldProject");
    expect(DbLib.IMPORT_PROJECT_WORKFLOW_NAME).toBe("importProject");
    expect(DbLib.COMMIT_VERSION_WORKFLOW_NAME).toBe("commitVersion");
    expect(DbLib.PUBLISH_VERSION_WORKFLOW_NAME).toBe("publishVersion");
    expect(DbLib.GIT_OPS_QUEUE_NAME).toBe("git-ops");
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.scaffold.workflowName).toBe(
      "scaffoldProject",
    );
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.import_verify?.workflowName).toBe(
      "importProject",
    );
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.commit?.workflowName).toBe(
      "commitVersion",
    );
    expect(DbLib.GIT_OPS_WORKFLOW_BY_KIND.publish?.workflowName).toBe(
      "publishVersion",
    );
  });
});
