---
name: prisma-schema-part-1-models
description: Task #4 Prisma schema decisions (User/Session/3 connections) + Prisma 7 connection strategy (prisma.config.ts + adapter-pg factory) and the first migration
metadata:
  type: decision
---

Task #4 (2026-07-17) added the first 5 Prisma models to `@supagloo/database-lib`
and the repo's **first migration** (`prisma/migrations/20260718025714_init/`).
Models: `User`, `Session`, `GithubConnection`, `OpenRouterConnection`,
`GlooConnection` (design-delta §2.1–2.5). Task #5 adds Project/version/job/
render/gallery — kept out. See [[database-lib-build-architecture]].

**Ambiguity resolutions (the design doc left these open):**
1. **Connection PKs = `userId String @id` (shared primary key).** The §3 ER
   diagram shows only `userId UK` on the three connections (no separate `id`).
   `@id` on `userId` is both PK and the 1:0..1 uniqueness — no surrogate key, no
   extra `@unique`. Applied to all three.
2. **`status` = plain required `String`, no `@default`.** Only example value is
   `"connected"`; persisted vocabulary is under-specified and UI-driven
   (`not-linked` = row absence, `pending` = transient client state, never
   persisted). A Prisma enum would migration-couple an unstable vocabulary for
   zero benefit; e2e only tests the field exists.
3. **No `createdAt`/`updatedAt` on connections.** Only `connectedAt` (+ Gloo
   `lastVerifiedAt`) are specced; `User` deliberately lists the audit pair and
   the connections don't. Both timestamp cols get `@default(now())` (specified
   fields, default is impl detail). Avoided untested surface.
4. **`onDelete: Cascade`** on `Session.userId` and all three connection FKs —
   orphaned sessions/connections have no valid meaning; no user-delete flow
   exists yet so pick the safe semantic now (vs Prisma's default `Restrict`).
   `@@index([userId])` added on `Session` only (the sole 1:many FK; connections'
   `userId` is already the PK).
5. **Prisma 7 connection strategy — two seams, one URL (`DATABASE_URL`):**
   - **CLI/migrate/validate:** root `prisma.config.ts` supplies
     `datasource.url = process.env.DATABASE_URL` (the `datasource db{}` block
     still can't carry a url — P1012). Prisma 7 does NOT auto-load `.env`, so the
     config calls `process.loadEnvFile()` (Node built-in, **no `dotenv` dep**),
     guarded; ambient env wins over the file.
   - **Runtime/tests:** `src/client.ts` exports
     `createPrismaClient({ connectionString })` wiring
     `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
     **Prisma 7's `prisma-client` generator REQUIRES a driver adapter to
     connect** — a bare `new PrismaClient()` won't. `@prisma/adapter-pg` is a
     runtime `dependency`, pinned **exact `7.8.0`** lock-step with `@prisma/client`
     (its version is NOT part of the prisma-version invariant test, but kept
     exact by convention). `pg`/`@types/pg` come transitively via adapter-pg.
     Centralizing the factory here (vs each consumer wiring its own adapter) keeps
     adapter⇄client version coupling in one place — same single-source discipline
     as the Prisma pin.
6. **First migration** via `prisma migrate dev --name init` (note: Prisma 7
   removed the `--skip-generate` flag). SQL committed; ships via `files:["dist","prisma"]`.

**`GithubConnection` stores `installationId` ONLY — no token column** (GitHub App
model, tokens minted on demand; see [[github-app-installation-tokens]] memory-agent).
Enforced three ways: runtime `ScalarFieldEnum` introspection, a `@ts-expect-error`
type-level check, and a live `information_schema.columns` e2e query.

**Tests (all green): unit `src/schema.test.ts`** (`prisma validate`;
`Prisma.<Model>ScalarFieldEnum` column-set introspection; schema-text
unique/`@id` assertions; a `tsc --noEmit` type check over
`tests/typecheck/models.type-assert.ts`). **E2E `tests/e2e/schema.e2e.ts`**
applies `prisma migrate deploy` then exercises unique `youversionUserId`/
`tokenHash`, 1:0..1 per-user connection uniqueness (dup PK → P2002), no-token-column,
and cascade delete — against Compose Postgres (`postgres://supagloo:supagloo@localhost:5432/supagloo`),
with a readiness preflight that errors clearly if Postgres is down (precondition:
`docker compose up -d postgres` from the root repo).

**Reusable facts for later tasks:** the generated `prisma-client` output exposes
runtime `Prisma.<Model>ScalarFieldEnum` (keys = scalar columns) but NO runtime
`Prisma.dmmf` — use ScalarFieldEnum for DB-free column introspection. Migrations
apply against the shared dev `supagloo` DB; scope test cleanup by a unique
`youversionUserId` prefix rather than truncating.
