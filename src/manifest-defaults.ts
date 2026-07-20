import type { ProjectManifest } from "./schemas";

/**
 * The production default `supagloo.project.json` for a freshly-scaffolded (blank)
 * project (design-delta §2.11). The scaffold workflow writes this as the manifest +
 * generated Remotion code, so it MUST be a schema-valid, EMPTY composition (zero
 * scenes). Scene content is populated later by the generation workflows.
 *
 * Default composition = short-form vertical (1080×1920 @30, 9:16) — the product's
 * primary scripture-video format. Returns a FRESH object each call (no shared-mutable
 * default a caller could accidentally mutate across projects).
 *
 * NOTE (flagged for review): the 9:16 default + narrator copy are product choices;
 * the dbos `emptyManifest` TEST fixture is 16:9 — they are independent (a test
 * fixture vs the production default).
 */
export function buildBlankManifest(): ProjectManifest {
  return {
    manifestVersion: 1,
    composition: { width: 1080, height: 1920, fps: 30, aspectRatio: "9:16" },
    scenes: [],
    narratorVoice: { description: "Calm, measured narrator" },
  };
}
