import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import { buildBlankManifest } from "./manifest-defaults";
import { ProjectManifestSchema } from "./schemas";

// Task #18: the production default manifest for a freshly-scaffolded (blank) project.
// The scaffold workflow writes it as supagloo.project.json + generated code, so it
// MUST be a schema-valid, empty composition. DB-free.

describe("Task #18 manifest-defaults — buildBlankManifest", () => {
  it("returns a schema-valid manifest with zero scenes", () => {
    const manifest = buildBlankManifest();
    expect(ProjectManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.scenes).toEqual([]);
    expect(manifest.narratorVoice.description.length).toBeGreaterThan(0);
  });

  it("returns a fresh object each call (no shared-mutable default)", () => {
    const a = buildBlankManifest();
    const b = buildBlankManifest();
    expect(a).not.toBe(b);
    a.scenes.push({
      id: "x",
      name: "X",
      scriptText: "t",
      reference: "R 1:1",
      translation: "KJV",
      visualPrompt: "p",
      durationSeconds: 1,
      captions: false,
    });
    expect(b.scenes).toEqual([]); // mutating one never leaks into another
  });

  it("is re-exported from the package entry", () => {
    expect(typeof DbLib.buildBlankManifest).toBe("function");
  });
});
