import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Options for {@link createPrismaClient}.
 */
export interface CreatePrismaClientOptions {
  /** Postgres connection string, e.g. `postgres://user:pass@host:5432/db`. */
  connectionString: string;
}

/**
 * Construct a ready-to-use {@link PrismaClient} for Postgres.
 *
 * Prisma 7's `prisma-client` generator (query compiler) has no built-in
 * datasource URL — a driver adapter is required to connect. This factory wires
 * the `@prisma/adapter-pg` adapter so every consumer (API, DBOS, tests) gets a
 * client the same way, with the adapter version pinned in lock-step with
 * `@prisma/client` here in the shared lib.
 */
export function createPrismaClient(
  options: CreatePrismaClientOptions,
): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}
