import type { ManifestScene } from "./schemas";

/**
 * The ONE rule reconciling a scene's AUTHORED length with the MEASURED length of its
 * own narration.
 *
 * A scene's `durationSeconds` originates in the LLM's `suggestedDurationSeconds`, which
 * has no relationship whatsoever to how long the verse takes to read aloud. When the
 * narration is longer, the shipped render simply cut it off mid-sentence. So: the scene
 * stretches to fit its narration, never the other way round.
 *
 * Why a derived helper instead of writing the larger value back into `durationSeconds`:
 * that field is user-editable in the studio, and overwriting it would silently discard a
 * duration the user chose AND make the value non-idempotent across regenerations (each
 * re-synthesis would ratchet it up). The manifest stays a record of intent; this derives
 * the effect.
 *
 * This must be applied at EVERY boundary that turns a scene into frames — the generated
 * Remotion composition, the studio timeline, and the studio preview player — or those
 * surfaces disagree about how long the video is. Per the repo's own lesson (memory
 * `one-rule-one-module-many-boundaries`): the RULE lives in one module and is applied at
 * each value's own boundary, rather than being re-derived per call site.
 *
 * `supagloo-nextjs` hand-mirrors this alongside the manifest schemas it already mirrors
 * (it does not import db-lib); `lib/studio/scene-duration.ts` is that mirror.
 */
export function effectiveSceneDurationSeconds(
  scene: Pick<ManifestScene, "durationSeconds" | "narrationDurationSeconds">,
): number {
  return Math.max(scene.durationSeconds, scene.narrationDurationSeconds ?? 0);
}
