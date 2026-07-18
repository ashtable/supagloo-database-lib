---
name: domain-zod-schemas
description: Task #7 db-lib domain Zod schemas — contracts, KJV/BSB constraint, enum-mirror drift test, JSON-column round-trip
metadata:
  type: decision
---

Task #7 (2026-07-18) added the shared domain Zod schemas (design-delta §2.11) to
`/Users/ash/code/supagloo-database-lib/src/schemas.ts`, `export *`-ed from
`src/index.ts`. Added `zod@^4.4.3` as a **runtime dependency** (matches
`supagloo-nextjs`; consumers get a resolvable zod). Single-file module (matches the
`secrets.ts`/`client.ts` single-file-per-concern convention); a `src/schemas/` dir
is the reversible move if the later API-DTO schemas (CreateProjectRequest, etc.) land.

**Exported schema consts (`*Schema`-suffixed) + inferred types (bare names):**
- Enum mirrors (9): `RepoVisibilitySchema`, `ProjectCreatedFromSchema`,
  `ProjectVersionStateSchema`, `RenderStatusSchema`, `GalleryVisibilitySchema`,
  `AiGenerationKindSchema`, `AiProviderSchema`, `ProjectJobKindSchema`,
  `JobStatusSchema`. **Hand-written `z.enum([...])`, NOT derived from the Prisma
  const** — they are wire/structured-output vocabularies that must stay explicit and
  stable. A unit "consistency test" pins each `.options` value-set to the LIVE
  generated const (`DbLib.<Enum>` from [[prisma-schema-part-2-conventions]]'s
  enums.ts seam); an intentional Prisma enum change forces a deliberate Zod edit and
  the test flags drift. No enum-mirror *value-type* is exported (the Prisma enum
  types already own that; a second `JobStatus` type would collide with `export *`).
- `TranslationSchema = z.enum(["KJV","BSB"])` — Zod-only KJV/BSB generation
  constraint ([[kjv-bsb-generation-only]], §9-Q10). `GalleryItem.translation` stays a
  plain Prisma String (display can show any translation); only manifest + storyboard
  scenes are constrained.
- Shared sub-schemas: `CompositionSpecSchema` {width,height,fps int>0; aspectRatio
  `/^\d+:\d+$/`}, `VoiceDescriptorSchema` {description≥1, label?}, `MusicBedSchema`
  {style, assetKey?nullable}, `EndCardSchema` {headline, subtext?}.
- `ProjectManifestSchema` (the `supagloo.project.json` format,
  [[composition-source-of-truth-in-repo]]): {manifestVersion: **literal 1**,
  composition, scenes[] (**may be empty** — permissive persisted format),
  narratorVoice (required), music?, endCard?}. `ManifestSceneSchema` {id, name,
  scriptText, reference, translation, visualPrompt, durationSeconds>0, captions:bool,
  visualAssetKey?nullable}. NOT persisted in Postgres — lives in the git repo; its
  round-trip target is `JSON.stringify`→`parse`→`safeParse` (a unit test).
- `GeneratedStoryboardSchema` (LLM output) {scenes[].**min(1)**, narratorVoice,
  musicStyle}. `StoryboardSceneSchema` = {name, scriptText, reference, translation,
  visualPrompt, suggestedDurationSeconds} — deliberately NO id/captions/visualAssetKey
  (assigned at manifest-conversion time). Persists to `AiGeneration.resultJson`.
- `SceneVisualPromptSchema` {visualPrompt} — reroll output, deliberately minimal.
- `NarrationSpecSchema` {voice, scenes[].min(1) of {sceneId, scriptText}} and
  `MusicSpecSchema` {style, durationSeconds>0} — audio-synth inputs; persist to
  `AiGeneration.input`.
- `RenderOutputSpecSchema = CompositionSpecSchema.extend({codec})` — render request +
  RenderJob width/height/fps/aspectRatio/codec columns.

**Conventions/decisions:** default zod object behavior (strip unknowns, NOT
`.strict()`); NO `z.default()` anywhere (keeps `z.infer` input===output);
`codec`/`aspectRatio` not over-constrained (free string / format regex only);
width/height not forced even. Only `AiGeneration.input`/`resultJson` (and
`ProjectJob.stages`, not schema'd this task) persist Zod JSON — that is the e2e
target.

**Tests:** `src/schemas.test.ts` (unit: enum drift ×9, accept/reject per schema,
manifest JSON round-trip, barrel-export check, + a `tsc --noEmit` gate over
`tests/typecheck/schemas.type-assert.ts`). `tests/e2e/domain-schemas.e2e.ts`
(persist GeneratedStoryboard→resultJson, NarrationSpec/MusicSpec→input, read back,
re-`safeParse`; + a negative "malformed persisted row fails safeParse" gate).
Reuses the `schema.e2e.ts` infra (DATABASE_URL fallback, migrate deploy,
RUN-namespaced users, cascade cleanup).
