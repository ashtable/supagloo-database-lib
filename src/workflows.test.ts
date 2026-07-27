import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
// Namespace import alongside the named ones below: constants added by a task in
// flight are read as `Workflows.X` so a missing export reads `undefined` (a clean
// assertion failure) instead of an ESM link error during the RED phase — the same
// convention src/schema.test.ts uses for generated enums.
import * as Workflows from "./workflows";
import {
  AI_GENERATION_QUEUE_NAME,
  AI_GENERATION_WORKFLOW_BY_KIND,
  COMMIT_VERSION_WORKFLOW_NAME,
  GENERATE_AUDIO_WORKFLOW_NAME,
  GENERATE_IMAGE_WORKFLOW_NAME,
  GENERATE_SCRIPT_WORKFLOW_NAME,
  GENERATE_VIDEO_WORKFLOW_NAME,
  GIT_OPS_QUEUE_NAME,
  GIT_OPS_WORKFLOW_BY_KIND,
  IMPORT_PROJECT_WORKFLOW_NAME,
  PUBLISH_VERSION_WORKFLOW_NAME,
  RENDER_QUEUE_NAME,
  RENDER_WORKFLOW_NAME,
  RENDER_WORKFLOW_TARGET,
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

  it("covers ALL six AI-generation kinds now wired (video was the last, #34)", () => {
    expect(Object.keys(AI_GENERATION_WORKFLOW_BY_KIND).sort()).toEqual([
      "image",
      "music",
      "narration",
      "script",
      "storyboard",
      "video",
    ]);
  });
});

describe("Task #34 workflows — generateVideo name + video routing", () => {
  it("pins the generate-video workflow name", () => {
    expect(GENERATE_VIDEO_WORKFLOW_NAME).toBe("generateVideo");
  });

  it("routes the video kind to generateVideo on the ai-generation queue", () => {
    expect(AI_GENERATION_WORKFLOW_BY_KIND.video).toEqual({
      workflowName: GENERATE_VIDEO_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
  });

  it("re-exports the generate-video name from the barrel", () => {
    expect(DbLib.GENERATE_VIDEO_WORKFLOW_NAME).toBe("generateVideo");
  });
});

describe("Task #33 workflows — generateAudio name + narration/music routing", () => {
  it("pins the generate-audio workflow name", () => {
    expect(GENERATE_AUDIO_WORKFLOW_NAME).toBe("generateAudio");
  });

  it("routes BOTH audio kinds (narration + music) to generateAudio on the ai-generation queue", () => {
    expect(AI_GENERATION_WORKFLOW_BY_KIND.narration).toEqual({
      workflowName: GENERATE_AUDIO_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
    expect(AI_GENERATION_WORKFLOW_BY_KIND.music).toEqual({
      workflowName: GENERATE_AUDIO_WORKFLOW_NAME,
      queueName: AI_GENERATION_QUEUE_NAME,
    });
  });

  it("re-exports the generate-audio name from the barrel", () => {
    expect(DbLib.GENERATE_AUDIO_WORKFLOW_NAME).toBe("generateAudio");
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

// Task #36: the render workflow's routing constants + enqueue target. `renderWorkflow`
// is the ONLY workflow on the dedicated `render` queue (workerConcurrency 1 — Chromium is
// heavy), so unlike the git-ops / ai-generation tables there is no kind→target MAP: a single
// `RENDER_WORKFLOW_TARGET` is the whole routing contract. Same shared-constant discipline —
// the dbos static registry and the API's render-enqueue path (task 37) import these SAME
// values, so the worker and the enqueuer can never disagree.

describe("Task #36 workflows — render name/queue + enqueue target", () => {
  it("pins the render workflow name and the render queue name", () => {
    expect(RENDER_WORKFLOW_NAME).toBe("render");
    expect(RENDER_QUEUE_NAME).toBe("render");
  });

  it("exposes a single render enqueue target built from those constants", () => {
    expect(RENDER_WORKFLOW_TARGET).toEqual({
      workflowName: RENDER_WORKFLOW_NAME,
      queueName: RENDER_QUEUE_NAME,
    });
  });

  it("keeps the render queue distinct from the git-ops and ai-generation queues", () => {
    expect(RENDER_QUEUE_NAME).not.toBe(GIT_OPS_QUEUE_NAME);
    expect(RENDER_QUEUE_NAME).not.toBe(AI_GENERATION_QUEUE_NAME);
  });

  it("re-exports the render routing constants from the barrel", () => {
    expect(DbLib.RENDER_WORKFLOW_NAME).toBe("render");
    expect(DbLib.RENDER_QUEUE_NAME).toBe("render");
    expect(DbLib.RENDER_WORKFLOW_TARGET.workflowName).toBe("render");
  });
});

// Task #42: the cleanup/janitor workflow's name + its own `maintenance` queue.
//
// Unlike every other workflow in this file, this one is never enqueued from an HTTP
// request — it is STATICALLY REGISTERED and then driven by DBOS's scheduler inside the
// dbos worker. So there is no kind→target MAP and no API-side enqueue lookup. The name
// still lives here for the same reason the others do: the dbos static registry pins it
// against this constant, so the registry and the scheduler can never disagree, and the
// name is greppable from any repo.

describe("Task #42 workflows — cleanupOrphanedAssets name + maintenance queue", () => {
  it("pins the cleanup workflow name", () => {
    expect(Workflows.CLEANUP_ORPHANED_ASSETS_WORKFLOW_NAME).toBe(
      "cleanupOrphanedAssets",
    );
  });

  it("pins the maintenance queue name", () => {
    expect(Workflows.MAINTENANCE_QUEUE_NAME).toBe("maintenance");
  });

  it("keeps the maintenance queue distinct from the three work queues", () => {
    // A janitor sharing the `render` queue would occupy the single render worker slot
    // (workerConcurrency 1) and stall a user-visible render; sharing `git-ops` or
    // `ai-generation` would consume a slot a user request is waiting on. Its own queue
    // is what makes the destructive daily sweep unable to starve real work.
    expect(Workflows.MAINTENANCE_QUEUE_NAME).not.toBe(GIT_OPS_QUEUE_NAME);
    expect(Workflows.MAINTENANCE_QUEUE_NAME).not.toBe(AI_GENERATION_QUEUE_NAME);
    expect(Workflows.MAINTENANCE_QUEUE_NAME).not.toBe(RENDER_QUEUE_NAME);
  });

  it("is in NEITHER kind→workflow routing table (it is scheduled, never enqueued)", () => {
    // Pinned as an absence on purpose: both tables are `satisfies Partial<Record<…Kind,
    // …>>` and both are documented as COMPLETE. A future reader "completing" them with
    // the janitor would imply an API caller can enqueue a destructive S3 sweep.
    const names = [
      ...Object.values(GIT_OPS_WORKFLOW_BY_KIND),
      ...Object.values(AI_GENERATION_WORKFLOW_BY_KIND),
    ].map((t) => t.workflowName);
    expect(names).not.toContain(
      Workflows.CLEANUP_ORPHANED_ASSETS_WORKFLOW_NAME,
    );
  });

  it("re-exports both constants from the barrel", () => {
    expect(DbLib.CLEANUP_ORPHANED_ASSETS_WORKFLOW_NAME).toBe(
      "cleanupOrphanedAssets",
    );
    expect(DbLib.MAINTENANCE_QUEUE_NAME).toBe("maintenance");
  });
});
