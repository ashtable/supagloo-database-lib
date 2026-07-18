import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/index";

// End-to-end proof of the Prisma schema against the real Compose Postgres:
// applies the committed migrations with `prisma migrate deploy`, then exercises
// unique/composite/cascade/soft-delete/JSON/enum behaviors through a real
// PrismaClient (Prisma 7 driver adapter). Precondition: Compose Postgres
// reachable at DATABASE_URL — `docker compose up -d postgres` from
// /Users/ash/code/supagloo.
//
// The setup/teardown hooks are module-level so both the Task #4 and Task #5
// suites share one migrate-deploy + one prefix-scoped cleanup. Cleanup deletes
// only users created by THIS run (youversionUserId startsWith RUN); FK cascade
// removes every child row (projects, versions, jobs, renders, gallery, upvotes),
// so the shared dev DB is never truncated.

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

// Caller-supplied workflow-id PK (RenderJob/AiGeneration/ProjectJob), namespaced
// to this run so prefix cleanup via user cascade removes them.
function rid(tag: string): string {
  return `${RUN}-${tag}-${randomUUID()}`;
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

async function makeProject(ownerId: string, slug: string) {
  return client.project.create({
    data: {
      slug,
      ownerId,
      name: slug,
      repoOwner: "ashtable",
      repoName: slug,
      repoVisibility: "private",
      createdFrom: "blank",
      currentBranch: "v0.0.1",
    },
  });
}

async function makeVersion(projectId: string, semver: string) {
  return client.projectVersion.create({
    data: {
      projectId,
      semver,
      branchName: `v${semver}`,
      state: "base",
      changedFiles: [],
    },
  });
}

async function makeRenderJob(
  projectId: string,
  versionId: string,
  userId: string,
) {
  return client.renderJob.create({
    data: {
      id: rid("rj"),
      projectId,
      versionId,
      userId,
      status: "queued",
      width: 1080,
      height: 1920,
      fps: 30,
      aspectRatio: "9:16",
      codec: "h264",
      runInBackground: false,
    },
  });
}

async function makeGalleryItem(
  renderJobId: string,
  projectId: string,
  ownerId: string,
) {
  return client.galleryItem.create({
    data: {
      renderJobId,
      projectId,
      ownerId,
      title: "Let There Be Light",
      description: "Genesis 1",
      scriptureReference: "GENESIS 1:1-4",
      translation: "KJV",
      scriptureBook: "GEN",
      durationSeconds: 30,
      videoAssetKey: `renders/${renderJobId}/output.mp4`,
      thumbnailAssetKey: `renders/${renderJobId}/thumb.jpg`,
      visibility: "public",
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

  // Apply the committed migrations (prisma.config.ts reads DATABASE_URL).
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

describe("e2e: Task #4 schema against Compose Postgres", () => {
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

describe("e2e: Task #5 schema against Compose Postgres", () => {
  it("migrated all seven new tables", async () => {
    const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "Project",
      "ProjectVersion",
      "ProjectJob",
      "RenderJob",
      "AiGeneration",
      "GalleryItem",
      "GalleryUpvote",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("creates NO Composition or Scene table (composition lives in the repo manifest)", async () => {
    const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    expect(names).not.toContain("Composition");
    expect(names).not.toContain("Scene");
  });

  it("allows the same slug for two different owners", async () => {
    const a = await makeUser("slug-a");
    const b = await makeUser("slug-b");
    const pa = await makeProject(a.id, "psalm-121");
    const pb = await makeProject(b.id, "psalm-121");
    expect(pa.slug).toBe("psalm-121");
    expect(pb.slug).toBe("psalm-121");
    expect(pa.ownerId).not.toBe(pb.ownerId);
  });

  it("rejects a duplicate slug for the same owner (composite unique ownerId+slug)", async () => {
    const a = await makeUser("slug-dupe");
    await makeProject(a.id, "genesis-1");
    const code = await violationCode(() => makeProject(a.id, "genesis-1"));
    expect(code).toBe("P2002");
  });

  it("enforces unique (projectId, semver) on ProjectVersion", async () => {
    const u = await makeUser("semver");
    const p1 = await makeProject(u.id, "semver-proj-1");
    const p2 = await makeProject(u.id, "semver-proj-2");
    await makeVersion(p1.id, "0.0.0");
    // same project + same semver → reject
    const code = await violationCode(() => makeVersion(p1.id, "0.0.0"));
    expect(code).toBe("P2002");
    // same project + different semver → ok
    const v2 = await makeVersion(p1.id, "0.0.1");
    expect(v2.semver).toBe("0.0.1");
    // different project + same semver → ok
    const v3 = await makeVersion(p2.id, "0.0.0");
    expect(v3.semver).toBe("0.0.0");
  });

  it("enforces unique renderJobId on GalleryItem (one gallery entry per render)", async () => {
    const u = await makeUser("gi-unique");
    const p = await makeProject(u.id, "gi-unique-proj");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, u.id);
    await makeGalleryItem(rj.id, p.id, u.id);
    const code = await violationCode(() => makeGalleryItem(rj.id, p.id, u.id));
    expect(code).toBe("P2002");
  });

  it("enforces composite unique (userId, galleryItemId) on GalleryUpvote", async () => {
    const owner = await makeUser("upv-owner");
    const voter = await makeUser("upv-voter");
    const voter2 = await makeUser("upv-voter2");
    const p = await makeProject(owner.id, "upv-proj");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, owner.id);
    const gi = await makeGalleryItem(rj.id, p.id, owner.id);
    const rj2 = await makeRenderJob(p.id, v.id, owner.id);
    const gi2 = await makeGalleryItem(rj2.id, p.id, owner.id);

    await client.galleryUpvote.create({
      data: { userId: voter.id, galleryItemId: gi.id },
    });
    // same voter + same item → reject
    const code = await violationCode(() =>
      client.galleryUpvote.create({
        data: { userId: voter.id, galleryItemId: gi.id },
      }),
    );
    expect(code).toBe("P2002");
    // different voter + same item → ok
    const other = await client.galleryUpvote.create({
      data: { userId: voter2.id, galleryItemId: gi.id },
    });
    expect(other.userId).toBe(voter2.id);
    // same voter + different item → ok
    const diffItem = await client.galleryUpvote.create({
      data: { userId: voter.id, galleryItemId: gi2.id },
    });
    expect(diffItem.galleryItemId).toBe(gi2.id);
  });

  it("supports soft delete via a nullable deletedAt (row persists)", async () => {
    const u = await makeUser("soft");
    const p = await makeProject(u.id, "soft-proj");
    expect(p.deletedAt).toBeNull();

    await client.project.update({
      where: { id: p.id },
      data: { deletedAt: new Date() },
    });

    // Row is still physically present after a soft delete.
    const found = await client.project.findUnique({ where: { id: p.id } });
    expect(found).not.toBeNull();
    expect(found?.deletedAt).not.toBeNull();

    // The "active projects" query shape (deletedAt: null) excludes it.
    const active = await client.project.findFirst({
      where: { id: p.id, deletedAt: null },
    });
    expect(active).toBeNull();
  });

  it("persists AiGeneration.providerJobId (nullable replay-safety field)", async () => {
    const u = await makeUser("provjob");
    const withId = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: u.id,
        kind: "video",
        provider: "openrouter",
        model: "some/model",
        input: { prompt: "a still ocean at dawn" },
        status: "running",
        providerJobId: "prov_abc123",
      },
    });
    const back = await client.aiGeneration.findUnique({ where: { id: withId.id } });
    expect(back?.providerJobId).toBe("prov_abc123");

    const without = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: u.id,
        kind: "script",
        provider: "gloo",
        model: "some/model",
        input: {},
        status: "queued",
      },
    });
    expect(without.providerJobId).toBeNull();
  });

  it("round-trips JSON columns (changedFiles, stages, input)", async () => {
    const u = await makeUser("json");
    const p = await makeProject(u.id, "json-proj");

    const changed = ["M src/scenes/Shelter.tsx", "A supagloo.project.json"];
    const v = await client.projectVersion.create({
      data: {
        projectId: p.id,
        semver: "0.0.2",
        branchName: "v0.0.2",
        state: "working",
        changedFiles: changed,
      },
    });
    const vBack = await client.projectVersion.findUnique({ where: { id: v.id } });
    expect(vBack?.changedFiles).toEqual(changed);

    const stages = [
      { key: "clone", label: "Clone", state: "done" },
      { key: "commit", label: "Commit", state: "running" },
    ];
    const pj = await client.projectJob.create({
      data: {
        id: rid("pj"),
        projectId: p.id,
        userId: u.id,
        kind: "commit",
        status: "running",
        stages,
      },
    });
    const pjBack = await client.projectJob.findUnique({ where: { id: pj.id } });
    expect(pjBack?.stages).toEqual(stages);

    const input = { passage: "Genesis 1:1-4", translation: "KJV" };
    const aig = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: u.id,
        kind: "storyboard",
        provider: "openrouter",
        model: "m",
        input,
        status: "queued",
      },
    });
    const aigBack = await client.aiGeneration.findUnique({ where: { id: aig.id } });
    expect(aigBack?.input).toEqual(input);
  });

  it("round-trips representative enum values through the Postgres enum types", async () => {
    const u = await makeUser("enums");
    const p = await client.project.create({
      data: {
        slug: "enum-proj",
        ownerId: u.id,
        name: "Enum Proj",
        repoOwner: "o",
        repoName: "r",
        repoVisibility: "private",
        createdFrom: "import",
        currentBranch: "v0.2.3",
      },
    });
    expect(p.repoVisibility).toBe("private");
    expect(p.createdFrom).toBe("import");

    const v = await client.projectVersion.create({
      data: {
        projectId: p.id,
        semver: "0.2.3",
        branchName: "v0.2.3",
        state: "working",
        changedFiles: [],
      },
    });
    expect(v.state).toBe("working");

    const rj = await client.renderJob.create({
      data: {
        id: rid("rj"),
        projectId: p.id,
        versionId: v.id,
        userId: u.id,
        status: "synthesizing",
        width: 1080,
        height: 1920,
        fps: 30,
        aspectRatio: "9:16",
        codec: "h264",
        runInBackground: true,
      },
    });
    expect(rj.status).toBe("synthesizing");

    const gi = await client.galleryItem.create({
      data: {
        renderJobId: rj.id,
        projectId: p.id,
        ownerId: u.id,
        title: "t",
        description: "d",
        scriptureReference: "GEN 1:1",
        translation: "KJV",
        scriptureBook: "GEN",
        durationSeconds: 10,
        videoAssetKey: "v",
        thumbnailAssetKey: "t",
        visibility: "unlisted",
      },
    });
    expect(gi.visibility).toBe("unlisted");

    const aig = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: u.id,
        kind: "image",
        provider: "gloo",
        model: "m",
        input: {},
        status: "running",
      },
    });
    expect(aig.kind).toBe("image");
    expect(aig.provider).toBe("gloo");
    expect(aig.status).toBe("running");

    const pj = await client.projectJob.create({
      data: {
        id: rid("pj"),
        projectId: p.id,
        userId: u.id,
        kind: "import_verify",
        status: "succeeded",
        stages: [],
      },
    });
    expect(pj.kind).toBe("import_verify");
    expect(pj.status).toBe("succeeded");
  });

  it("supports incrementing upvoteCount in the same transaction as a GalleryUpvote insert", async () => {
    const owner = await makeUser("cnt-owner");
    const voter = await makeUser("cnt-voter");
    const p = await makeProject(owner.id, "cnt-proj");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, owner.id);
    const gi = await makeGalleryItem(rj.id, p.id, owner.id);
    expect(gi.upvoteCount).toBe(0);

    await client.$transaction([
      client.galleryUpvote.create({
        data: { userId: voter.id, galleryItemId: gi.id },
      }),
      client.galleryItem.update({
        where: { id: gi.id },
        data: { upvoteCount: { increment: 1 } },
      }),
    ]);

    const after = await client.galleryItem.findUnique({ where: { id: gi.id } });
    expect(after?.upvoteCount).toBe(1);
  });

  it("cascade-deletes versions, jobs, renders, gallery items and upvotes when a Project is deleted", async () => {
    const owner = await makeUser("casc-owner");
    const voter = await makeUser("casc-voter");
    const p = await makeProject(owner.id, "casc-proj");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, owner.id);
    const gi = await makeGalleryItem(rj.id, p.id, owner.id);
    await client.galleryUpvote.create({
      data: { userId: voter.id, galleryItemId: gi.id },
    });
    await client.projectJob.create({
      data: {
        id: rid("pj"),
        projectId: p.id,
        userId: owner.id,
        kind: "scaffold",
        status: "queued",
        stages: [],
      },
    });
    await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: owner.id,
        projectId: p.id,
        kind: "script",
        provider: "openrouter",
        model: "m",
        input: {},
        status: "queued",
      },
    });

    await client.project.delete({ where: { id: p.id } });

    expect(await client.projectVersion.count({ where: { projectId: p.id } })).toBe(0);
    expect(await client.projectJob.count({ where: { projectId: p.id } })).toBe(0);
    expect(await client.renderJob.count({ where: { projectId: p.id } })).toBe(0);
    expect(await client.galleryItem.count({ where: { projectId: p.id } })).toBe(0);
    expect(await client.aiGeneration.count({ where: { projectId: p.id } })).toBe(0);
    expect(await client.galleryUpvote.count({ where: { galleryItemId: gi.id } })).toBe(0);
  });

  it("cascade-deletes owned projects, versions and upvotes when a User is deleted", async () => {
    const owner = await makeUser("ucasc-owner");
    const other = await makeUser("ucasc-other");
    const p = await makeProject(owner.id, "ucasc-proj");
    const v = await makeVersion(p.id, "0.0.0");

    // owner casts an upvote on ANOTHER user's gallery item.
    const op = await makeProject(other.id, "ucasc-other-proj");
    const ov = await makeVersion(op.id, "0.0.0");
    const orj = await makeRenderJob(op.id, ov.id, other.id);
    const ogi = await makeGalleryItem(orj.id, op.id, other.id);
    const upvote = await client.galleryUpvote.create({
      data: { userId: owner.id, galleryItemId: ogi.id },
    });

    await client.user.delete({ where: { id: owner.id } });

    expect(await client.project.count({ where: { id: p.id } })).toBe(0);
    expect(await client.projectVersion.count({ where: { id: v.id } })).toBe(0);
    expect(await client.galleryUpvote.count({ where: { id: upvote.id } })).toBe(0);
    // the other user's gallery item survives (only the voter was deleted).
    expect(await client.galleryItem.count({ where: { id: ogi.id } })).toBe(1);
  });
});
