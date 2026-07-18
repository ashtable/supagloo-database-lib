/**
 * The exact Prisma version this package's generated client is built against.
 *
 * This MUST stay equal to the `prisma` / `@prisma/client` pins in package.json
 * and to `supagloo.prismaVersion` (enforced by src/prisma-version.test.ts).
 * Consumers (API, DBOS) pin the identical exact version and verify it against
 * this constant — see the check-prisma-version script (later task #2).
 *
 * Kept in its own dependency-free module so the self-consistency check never
 * has to load the heavy generated client.
 */
export const PRISMA_VERSION = "7.8.0" as const;
