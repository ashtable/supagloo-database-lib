---
name: prisma-schema-part-2-conventions
description: Task #5 db-lib schema decisions — shared JobStatus enum, all-Cascade FKs, workflow-id PK-no-default, enum test seam
metadata:
  type: decision
---

Task #5 (2026-07-17) added `Project`, `ProjectVersion`, `RenderJob`,
`AiGeneration`, `GalleryItem`, `GalleryUpvote`, `ProjectJob` (+ 9 enums) to
`/Users/ash/code/supagloo-database-lib/prisma/schema.prisma`. Migration
`20260718034957_project_render_gallery_models`. Durable, non-obvious choices:

- **Shared `enum JobStatus`** (`queued|running|succeeded|failed|canceled`) is used
  by BOTH `ProjectJob.status` and `AiGeneration.status` — one enum, not two
  identical ones. **Why:** both are DBOS-workflow-backed jobs with the same
  lifecycle; DRY; §2.11 Zod mirror mirrors one enum. `RenderJob` keeps its own
  richer `RenderStatus` (adds bundling/synthesizing/encoding/uploading). **Flagged
  for review**; split is a mechanical `ALTER COLUMN TYPE` migration if the two
  lifecycles ever diverge.
- **Every FK is `onDelete: Cascade`** — to `User` (the #4 convention) AND to the
  owning aggregate root (owned-child rule), including the two nullable FKs
  (`AiGeneration.projectId`, `ProjectJob.versionId`). `SetNull` was the considered
  alternative for the nullables; Cascade chosen for graph-cleanliness (projects are
  soft-deleted via `deletedAt`, versions ~never hard-deleted). Postgres tolerates
  the overlapping cascade paths into `GalleryItem`/`GalleryUpvote`. **Flagged.**
- **`id String @id` with NO `@default`** on `RenderJob`, `AiGeneration`,
  `ProjectJob` — the id IS the DBOS workflow id, supplied by the caller at enqueue
  (records the [[dbos-static-workflows-and-enqueue-pattern]] `workflowID = record
  id` contract at the schema level). Surrogate-PK models (Project, ProjectVersion,
  GalleryItem, GalleryUpvote) use `@default(cuid())`.
- **No `Composition`/`Scene` table** (enforces [[composition-source-of-truth-in-repo]]).
  Asserted 3 ways: information_schema (e2e), `Prisma.*ScalarFieldEnum` undefined +
  schema-text regex (unit), and a `@ts-expect-error DbLib.Composition/Scene` in the
  type-assert fixture. `AiGeneration.sceneId` is a plain `String?` (manifest scene
  id), NOT a FK. `Project.lastRenderJobId` is a plain `String?` pointer, NOT a
  relation (avoids a 2nd Project↔RenderJob relation needing `@relation` names).
- **Timestamp defaults:** `@default(now())` on creation-time non-null timestamps
  (`createdAt`, `Project.lastOpenedAt`, `GalleryItem.publishedAt`,
  `GalleryUpvote.createdAt`); NO default on nullable lifecycle timestamps
  (`deletedAt`, `startedAt`, `completedAt`, `ProjectVersion.publishedAt`).
- **Test seam for schema enums:** the `prisma-client` generator emits each schema
  enum to `src/generated/prisma/enums.ts` as `export const X = { a: 'a', … } as
  const`, re-exported through `client.ts` → `src/index.ts`. Unit tests import them
  via a namespace import (`import * as DbLib`) so a missing enum reads `undefined`
  (clean RED) instead of an ESM link error. Columns still introspected via
  `Prisma.<Model>ScalarFieldEnum` (keys = scalar columns; relation fields excluded).
- Enum values `private`/`public`/`import` are valid Prisma identifiers — `prisma
  validate` accepts them; no `@map` needed (repo convention: zero `@map`/`@@map`).
