# Tech Lead — Shared Memory Index (this repo)

This is the shared, cross-session memory for the **tech-lead** (Opus) and
**fabulous-tech-lead** (Fable) persona, **scoped to this repository**. Both
engines read and write here; this memory does not cross into other repos.

Each entry below points to one memory file in this directory. Keep this index to
one line per memory (`- [Title](file.md) — hook`); put the actual content in the
individual files, never here.

## Memories

<!-- Add entries as you learn durable technical facts. Example:
- [Non-UI e2e run via node test runner](non-ui-e2e-runner.md) — how integration tests are invoked
-->

- [database-lib build architecture](database-lib-build-architecture.md) — Prisma 7 `prisma-client` generator + CJS tsc → dist; dep layout, version pin, gotchas
- [check-prisma-version tool](check-prisma-version-tool.md) — consumer-side exact-pin enforcement (bin + subpath export); pass/fail policy; why `missing` is tolerated
- [Prisma schema part 1 + first migration](prisma-schema-part-1-models.md) — Task #4 models (User/Session/3 connections), the 6 ambiguity resolutions, Prisma 7 connection strategy (prisma.config.ts + adapter-pg createPrismaClient factory)
- [Prisma schema part 2 conventions](prisma-schema-part-2-conventions.md) — task-5: shared JobStatus enum, all-Cascade FKs, workflow-id PK-no-default, no Composition/Scene, enum test seam
- [Secret-crypto helpers](secret-crypto-helpers.md) — task-6: encryptSecret/decryptSecret contract, AES-256-GCM wire format (base64 of ver|iv|tag|ct), 64-hex key, SecretCryptoError codes
- [Domain Zod schemas](domain-zod-schemas.md) — task-7: §2.11 schema contracts, KJV/BSB TranslationSchema, hand-written enum mirrors + drift test, zod@^4 runtime dep, JSON-column round-trip
