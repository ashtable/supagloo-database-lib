import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/index";

// End-to-end proof of the Task #4 schema against the real Compose Postgres:
// applies the committed migration with `prisma migrate deploy`, then exercises
// the unique/1:0..1/cascade behaviors through a real PrismaClient (Prisma 7
// driver adapter). Precondition: Compose Postgres reachable at DATABASE_URL —
// `docker compose up -d postgres` from /Users/ash/code/supagloo.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://supagloo:supagloo@localhost:5432/supagloo";

// Unique per run so cleanup never touches unrelated rows in the shared dev DB.
const RUN = `test-${randomUUID()}`;

let client: ReturnType<typeof createPrismaClient>;

function yv(tag: string): string {
  return `${RUN}-${tag}`;
}

async function makeUser(tag: string) {
  return client.user.create({
    data: {
      youversionUserId: yv(tag),
      displayName: `User ${tag}`,
      email: `${tag}@example.com`,
      avatarInitials: "US",
    },
  });
}

// Returns the Prisma error code if the write violated a constraint, else fails.
async function violationCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
  throw new Error("expected a constraint violation, but the write succeeded");
}

describe("e2e: Task #4 schema against Compose Postgres", () => {
  beforeAll(async () => {
    client = createPrismaClient({ connectionString: DATABASE_URL });

    // Readiness preflight with an actionable message.
    try {
      await client.$queryRawUnsafe("SELECT 1");
    } catch (err) {
      throw new Error(
        `Compose Postgres not reachable at ${DATABASE_URL}. ` +
          "Run `docker compose up -d postgres` from /Users/ash/code/supagloo. " +
          `Underlying error: ${String(err)}`,
      );
    }

    // Apply the committed migration (prisma.config.ts reads DATABASE_URL).
    const res = spawnSync(npx, ["prisma", "migrate", "deploy"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL },
    });
    if (res.status !== 0) {
      throw new Error(
        `prisma migrate deploy failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`,
      );
    }
  });

  afterAll(async () => {
    if (client) {
      await client.user.deleteMany({
        where: { youversionUserId: { startsWith: RUN } },
      });
      await client.$disconnect();
    }
  });

  it("migrated all five tables", async () => {
    const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "User",
      "Session",
      "GithubConnection",
      "OpenRouterConnection",
      "GlooConnection",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("enforces unique youversionUserId", async () => {
    await makeUser("yv-a");
    const code = await violationCode(() =>
      client.user.create({
        data: {
          youversionUserId: yv("yv-a"),
          displayName: "dupe",
          email: "dupe@example.com",
          avatarInitials: "DP",
        },
      }),
    );
    expect(code).toBe("P2002");
  });

  it("enforces unique tokenHash across users", async () => {
    const u1 = await makeUser("th-1");
    const u2 = await makeUser("th-2");
    const tokenHash = `${RUN}-hash`;
    await client.session.create({
      data: { userId: u1.id, tokenHash, expiresAt: new Date(Date.now() + 3.6e6) },
    });
    const code = await violationCode(() =>
      client.session.create({
        data: {
          userId: u2.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 3.6e6),
        },
      }),
    );
    expect(code).toBe("P2002");
  });

  it("enforces 1:0..1 GithubConnection per user", async () => {
    const u1 = await makeUser("gh-1");
    const u2 = await makeUser("gh-2");
    const data = {
      githubLogin: "@ashsrinivas",
      installationId: "inst_123",
      repositorySelection: "selected",
      status: "connected",
    };
    await client.githubConnection.create({ data: { userId: u1.id, ...data } });
    // Same user again → duplicate primary key.
    const code = await violationCode(() =>
      client.githubConnection.create({ data: { userId: u1.id, ...data } }),
    );
    expect(code).toBe("P2002");
    // A different user can still connect.
    const second = await client.githubConnection.create({
      data: { userId: u2.id, ...data },
    });
    expect(second.userId).toBe(u2.id);
  });

  it("enforces 1:0..1 OpenRouterConnection per user", async () => {
    const u1 = await makeUser("or-1");
    const u2 = await makeUser("or-2");
    const data = {
      apiKeyCiphertext: "cipher",
      keyLast4: "4f2a",
      status: "connected",
    };
    await client.openRouterConnection.create({ data: { userId: u1.id, ...data } });
    const code = await violationCode(() =>
      client.openRouterConnection.create({ data: { userId: u1.id, ...data } }),
    );
    expect(code).toBe("P2002");
    const second = await client.openRouterConnection.create({
      data: { userId: u2.id, ...data },
    });
    expect(second.userId).toBe(u2.id);
  });

  it("enforces 1:0..1 GlooConnection per user", async () => {
    const u1 = await makeUser("gl-1");
    const u2 = await makeUser("gl-2");
    const data = {
      clientId: "client_abc",
      clientSecretCiphertext: "cipher",
      status: "connected",
    };
    await client.glooConnection.create({ data: { userId: u1.id, ...data } });
    const code = await violationCode(() =>
      client.glooConnection.create({ data: { userId: u1.id, ...data } }),
    );
    expect(code).toBe("P2002");
    const second = await client.glooConnection.create({
      data: { userId: u2.id, ...data },
    });
    expect(second.userId).toBe(u2.id);
  });

  it("stores installationId and no token column on GithubConnection", async () => {
    const rows = await client.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'GithubConnection'",
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toContain("installationId");
    expect(cols.filter((c) => /token/i.test(c))).toEqual([]);
  });

  it("cascade-deletes sessions and connections when the user is deleted", async () => {
    const u = await makeUser("cascade");
    await client.session.create({
      data: {
        userId: u.id,
        tokenHash: `${RUN}-cascade-hash`,
        expiresAt: new Date(Date.now() + 3.6e6),
      },
    });
    await client.githubConnection.create({
      data: {
        userId: u.id,
        githubLogin: "@x",
        installationId: "i",
        repositorySelection: "all",
        status: "connected",
      },
    });
    await client.openRouterConnection.create({
      data: { userId: u.id, apiKeyCiphertext: "c", keyLast4: "0000", status: "connected" },
    });
    await client.glooConnection.create({
      data: { userId: u.id, clientId: "c", clientSecretCiphertext: "c", status: "connected" },
    });

    await client.user.delete({ where: { id: u.id } });

    expect(await client.session.count({ where: { userId: u.id } })).toBe(0);
    expect(await client.githubConnection.count({ where: { userId: u.id } })).toBe(0);
    expect(await client.openRouterConnection.count({ where: { userId: u.id } })).toBe(0);
    expect(await client.glooConnection.count({ where: { userId: u.id } })).toBe(0);
  });
});
