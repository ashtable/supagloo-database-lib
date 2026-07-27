-- CreateIndex
-- Task #42: the daily cleanupOrphanedAssets workflow purges expired sessions on
-- `"expiresAt" < now()`. Sessions are sliding (every authenticated request re-stamps
-- expiresAt), so without this index the nightly purge sequentially scans the busiest
-- small table in the schema.
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
-- Task #49: the DB-level backing for "one repo <-> one project PER OWNER".
--
-- Hand-written, NOT generated: the Prisma DSL's `@@unique` has no `where`, so a partial
-- unique index cannot be expressed in schema.prisma. See the note on `model Project`.
-- MEASURED on Prisma 7.8.0: `prisma migrate diff` reports "No difference detected." in
-- BOTH directions afterwards -- the engine does not model a predicated index, so this
-- adds no standing drift. It is invisible to the datamodel and lives only here.
--
-- PARTIAL (`WHERE "deletedAt" IS NULL`) is load-bearing: Project is soft-deleted, and a
-- TOTAL unique would count tombstones, permanently blocking a user from re-creating a
-- project for a repo they had previously deleted.
--
-- The NAME is a cross-repo contract: a P2002 from this index is matched by name to
-- answer the losing concurrent POST /v1/projects with 409 project_exists instead of a
-- raw 500. MEASURED on Prisma 7.8.0 + @prisma/adapter-pg: the name is NOT in
-- `meta.target` (there is none) but in `meta.driverAdapterError.cause.originalMessage`
-- -- so consumers use the exported reader `isUniqueViolationOn(err,
-- PROJECT_ACTIVE_REPO_UNIQUE_INDEX)` rather than re-deriving it.
--
-- No data fixup ships here by design: the pre-deploy duplicate check
--   SELECT "ownerId","repoOwner","repoName", count(*) FROM "Project"
--     WHERE "deletedAt" IS NULL GROUP BY 1,2,3 HAVING count(*) > 1;
-- returned zero rows across 4201 active projects. Duplicates, if an environment ever has
-- them, are resolved by hand before deploying -- an "indexes only" migration must never
-- silently destroy rows.
CREATE UNIQUE INDEX "Project_ownerId_repoOwner_repoName_active_key"
    ON "Project"("ownerId", "repoOwner", "repoName")
    WHERE "deletedAt" IS NULL;
