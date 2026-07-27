import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GalleryMakingOfSchema, createPrismaClient } from "../../src/index";
// Namespace import for constants added by a task in flight: a missing export reads
// `undefined` (clean assertion failure) instead of taking the whole spec down with an
// ESM link error during the RED phase.
import * as DbLib from "../../src/index";

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

// `repo` defaults to the historical `ashtable/<slug>` so every pre-existing call site
// keeps its exact behaviour; task #49's tests need to drive the repo triple directly.
async function makeProject(
  ownerId: string,
  slug: string,
  repo?: { repoOwner?: string; repoName?: string; deletedAt?: Date },
) {
  return client.project.create({
    data: {
      slug,
      ownerId,
      name: slug,
      repoOwner: repo?.repoOwner ?? "ashtable",
      repoName: repo?.repoName ?? slug,
      repoVisibility: "private",
      createdFrom: "blank",
      currentBranch: "v0.0.1",
      ...(repo?.deletedAt ? { deletedAt: repo.deletedAt } : {}),
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

/**
 * The ORDERED column list of every index on `table`, straight out of the catalog after
 * `prisma migrate deploy` — the only evidence that the migration actually created the
 * indexes IN THE DATABASE.
 *
 * Why the catalog and not `pg_indexes.indexdef`: `indexdef` is a rendered string whose
 * quoting varies with the identifier (`visibility` bare, `"publishedAt"` quoted), so a
 * substring match on it is fragile and, worse, can be satisfied by an index whose
 * columns are in the WRONG ORDER. Column order is the whole point of a composite sort
 * index — `(visibility, upvoteCount, id)` serves the listing, `(id, upvoteCount,
 * visibility)` serves nothing — so it is read positionally.
 */
async function indexColumns(
  table: string,
): Promise<Record<string, string[]>> {
  const rows = await client.$queryRawUnsafe<
    Array<{ index_name: string; pos: number; col: string }>
  >(
    `SELECT i.relname AS index_name,
            k.ord::int AS pos,
            pg_get_indexdef(i.oid, k.ord::int, true) AS col
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_index ix ON ix.indrelid = t.oid
       JOIN pg_class i ON i.oid = ix.indexrelid
       CROSS JOIN LATERAL generate_series(1, ix.indnatts) AS k(ord)
      WHERE n.nspname = 'public' AND t.relname = $1
      ORDER BY i.relname, k.ord`,
    table,
  );
  const byIndex: Record<string, string[]> = {};
  for (const row of [...rows].sort((a, b) => Number(a.pos) - Number(b.pos))) {
    (byIndex[row.index_name] ??= []).push(row.col.replaceAll('"', ""));
  }
  return byIndex;
}

/**
 * Per-index UNIQUEness and the partial predicate, straight out of the catalog.
 *
 * `indexColumns` above answers "which columns, in what order"; it cannot distinguish a
 * plain index from a unique one, nor a full index from a PARTIAL one. Both distinctions
 * are the entire content of task #49: a non-unique index enforces nothing, and a
 * non-partial unique would permanently block re-creating a repo whose project was
 * soft-deleted. `pg_get_expr(indpred, …)` renders the `WHERE` clause the same way
 * Postgres normalized it, so it is compared as a normalized string, not as authored SQL.
 */
async function indexFacts(
  table: string,
): Promise<Record<string, { unique: boolean; predicate: string | null }>> {
  const rows = await client.$queryRawUnsafe<
    Array<{ index_name: string; is_unique: boolean; predicate: string | null }>
  >(
    `SELECT i.relname AS index_name,
            ix.indisunique AS is_unique,
            pg_get_expr(ix.indpred, ix.indrelid, true) AS predicate
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_index ix ON ix.indrelid = t.oid
       JOIN pg_class i ON i.oid = ix.indexrelid
      WHERE n.nspname = 'public' AND t.relname = $1`,
    table,
  );
  const byIndex: Record<string, { unique: boolean; predicate: string | null }> =
    {};
  for (const row of rows) {
    byIndex[row.index_name] = {
      unique: row.is_unique,
      predicate: row.predicate,
    };
  }
  return byIndex;
}

// ---------------------------------------------------------------------------
// Task #42 — Session.expiresAt index, IN the database
// ---------------------------------------------------------------------------
// The daily cleanup workflow purges `Session WHERE "expiresAt" < now()`. Session is the
// busiest small table in the schema (a row per sign-in, re-stamped on every
// authenticated request because sessions are sliding), so the purge without this index
// is a full sequential scan. The schema-text and migration-SQL assertions live in
// src/schema.test.ts; this is the one place that asks the running database.
describe("e2e: Task #42 Session.expiresAt index in Postgres", () => {
  it("created Session_expiresAt_idx on expiresAt (E-SE1)", async () => {
    const indexes = await indexColumns("Session");
    expect(
      indexes["Session_expiresAt_idx"],
      "Session_expiresAt_idx missing from the DATABASE (did migrate deploy run?)",
    ).toEqual(["expiresAt"]);
  });

  it("made it a plain, non-partial index — not a unique", async () => {
    // A UNIQUE here would reject two sessions that happen to expire in the same
    // millisecond, i.e. two tabs signing in together. A PARTIAL one would silently not
    // cover the purge predicate it exists for.
    const facts = await indexFacts("Session");
    expect(facts["Session_expiresAt_idx"]?.unique).toBe(false);
    expect(facts["Session_expiresAt_idx"]?.predicate).toBeNull();
  });

  it("kept the pre-existing userId index and tokenHash unique (additive migration)", async () => {
    const indexes = await indexColumns("Session");
    expect(indexes["Session_userId_idx"]).toEqual(["userId"]);
    expect(indexes["Session_tokenHash_key"]).toEqual(["tokenHash"]);
    expect(indexes["Session_pkey"]).toEqual(["id"]);
  });
});

// ---------------------------------------------------------------------------
// Task #49 — the Project active-repo PARTIAL UNIQUE index, IN the database
// ---------------------------------------------------------------------------
// This is the DB-level backing for the "one repo ↔ one project per owner" invariant that
// `POST /v1/projects` previously enforced with a findFirst-then-create outside the write
// transaction — a TOCTOU two concurrent requests both pass. Text assertions cannot prove
// a race is closed; only the running database can.
describe("e2e: Task #49 Project active-repo partial unique index in Postgres", () => {
  const INDEX = "Project_ownerId_repoOwner_repoName_active_key";

  it("exposes the index name as a shared constant matching the deployed index", () => {
    // The API maps P2002 → 409 by matching `meta.target` against this constant.
    expect(DbLib.PROJECT_ACTIVE_REPO_UNIQUE_INDEX).toBe(INDEX);
  });

  it("created it UNIQUE, PARTIAL on deletedAt IS NULL, over the three columns (E-PU1)", async () => {
    const indexes = await indexColumns("Project");
    expect(
      indexes[INDEX],
      "the partial unique index is missing from the DATABASE (did migrate deploy run?)",
    ).toEqual(["ownerId", "repoOwner", "repoName"]);

    const facts = await indexFacts("Project");
    expect(facts[INDEX]?.unique, "a non-unique index enforces nothing").toBe(
      true,
    );
    // Postgres normalizes the predicate; this is `pg_get_expr(..., pretty := true)`'s
    // exact rendering (pg_get_indexdef would wrap it in parens — measured, not guessed).
    // The predicate is the difference between "a soft-deleted project blocks that repo
    // forever" and the delete-then-recreate flow the product depends on, so it is
    // asserted as a value, not merely as "is partial".
    expect(facts[INDEX]?.predicate).toBe('"deletedAt" IS NULL');
  });

  it("REJECTS a second ACTIVE project for the same (ownerId, repoOwner, repoName) (E-PU2)", async () => {
    const u = await makeUser("repo-race");
    await makeProject(u.id, "race-a", {
      repoOwner: "ashtable",
      repoName: `race-${RUN}`,
    });
    // Different slug (so the pre-existing ownerId+slug unique cannot be what fires),
    // same repo triple — exactly the losing concurrent POST /v1/projects.
    let caught: unknown;
    try {
      await makeProject(u.id, "race-b", {
        repoOwner: "ashtable",
        repoName: `race-${RUN}`,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, "the duplicate active project was ACCEPTED").toBeDefined();
    expect((caught as { code?: string }).code).toBe("P2002");

    // The load-bearing half for the API. MEASURED, not assumed: on Prisma 7.8.0 with
    // @prisma/adapter-pg there is NO `meta.target` at all — the violated index name is
    // only reachable through `meta.driverAdapterError.cause.originalMessage`. A mapper
    // reading `err.meta.target` gets `undefined` and falls through to a 500, and no
    // fixture-based unit test would catch it. So the REAL error is fed to the shipped
    // reader here, which is what makes the unit fixtures in src/constraints.test.ts
    // trustworthy.
    expect((caught as { meta?: { target?: unknown } }).meta?.target).toBeUndefined();
    expect(DbLib.uniqueViolationIndexName(caught)).toBe(INDEX);
    expect(DbLib.isUniqueViolationOn(caught, INDEX)).toBe(true);
  });

  it("distinguishes this index from the per-owner slug unique on the same table (E-PU2b)", async () => {
    // Both uniques live on Project and both can fire from one `create`. If the reader
    // could not tell them apart, a duplicate SLUG would be answered with "a project
    // already exists for this repository" — a wrong, and confusing, 409.
    const u = await makeUser("repo-slug-vs-repo");
    await makeProject(u.id, "same-slug", {
      repoOwner: "ashtable",
      repoName: `slugdiff-a-${RUN}`,
    });
    let caught: unknown;
    try {
      await makeProject(u.id, "same-slug", {
        repoOwner: "ashtable",
        repoName: `slugdiff-b-${RUN}`,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe("P2002");
    expect(DbLib.uniqueViolationIndexName(caught)).toBe("Project_ownerId_slug_key");
    expect(DbLib.isUniqueViolationOn(caught, INDEX)).toBe(false);
  });

  it("ALLOWS the same repo again once the first project is SOFT-DELETED (E-PU3)", async () => {
    const u = await makeUser("repo-recreate");
    const first = await makeProject(u.id, "recreate-a", {
      repoOwner: "ashtable",
      repoName: `recreate-${RUN}`,
    });
    await client.project.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });
    // Delete-then-recreate is a real product flow (10a's delete action, then importing
    // the same repo back). A TOTAL unique would block it forever — this is precisely
    // why the index carries `WHERE "deletedAt" IS NULL`.
    const second = await makeProject(u.id, "recreate-b", {
      repoOwner: "ashtable",
      repoName: `recreate-${RUN}`,
    });
    expect(second.deletedAt).toBeNull();
    expect(second.id).not.toBe(first.id);
  });

  it("ALLOWS two SOFT-DELETED rows for the same repo (the predicate really excludes them) (E-PU4)", async () => {
    const u = await makeUser("repo-tombstones");
    const when = new Date();
    await makeProject(u.id, "tomb-a", {
      repoOwner: "ashtable",
      repoName: `tomb-${RUN}`,
      deletedAt: when,
    });
    const b = await makeProject(u.id, "tomb-b", {
      repoOwner: "ashtable",
      repoName: `tomb-${RUN}`,
      deletedAt: when,
    });
    expect(b.deletedAt).not.toBeNull();
    expect(
      await client.project.count({
        where: { ownerId: u.id, repoName: `tomb-${RUN}` },
      }),
    ).toBe(2);
  });

  it("ALLOWS the same repo for a DIFFERENT owner (the invariant is per-owner) (E-PU5)", async () => {
    // design-delta §2.6 specifies uniqueness only on (ownerId, slug); task #49 adds
    // "one repo ↔ one project PER OWNER", not a global claim on a GitHub repo path.
    const a = await makeUser("repo-owner-a");
    const b = await makeUser("repo-owner-b");
    const shared = { repoOwner: "ashtable", repoName: `shared-${RUN}` };
    const pa = await makeProject(a.id, "shared-a", shared);
    const pb = await makeProject(b.id, "shared-b", shared);
    expect(pa.repoName).toBe(pb.repoName);
    expect(pa.ownerId).not.toBe(pb.ownerId);
  });
});

// The two composite sort indexes ARE the task-#39 migration. Every other assertion
// about them in this repo reads TEXT — the schema file or the migration SQL — and text
// can be commented out, malformed, or simply never applied. This is the one place that
// asks the running database what it actually has.
describe("e2e: Task #39 gallery sort indexes in Postgres", () => {
  it("created both composite indexes on GalleryItem, in the designed column order", async () => {
    const indexes = await indexColumns("GalleryItem");
    expect(
      indexes["GalleryItem_visibility_publishedAt_id_idx"],
      "sort=newest index missing from the DATABASE (did migrate deploy run?)",
    ).toEqual(["visibility", "publishedAt", "id"]);
    expect(
      indexes["GalleryItem_visibility_upvoteCount_id_idx"],
      "sort=popular (the DEFAULT sort) index missing from the DATABASE",
    ).toEqual(["visibility", "upvoteCount", "id"]);
  });

  it("kept the three pre-existing single-column indexes and the renderJobId unique", async () => {
    const indexes = await indexColumns("GalleryItem");
    expect(indexes["GalleryItem_projectId_idx"]).toEqual(["projectId"]);
    expect(indexes["GalleryItem_ownerId_idx"]).toEqual(["ownerId"]);
    expect(indexes["GalleryItem_scriptureBook_idx"]).toEqual(["scriptureBook"]);
    expect(indexes["GalleryItem_renderJobId_key"]).toEqual(["renderJobId"]);
    expect(indexes["GalleryItem_pkey"]).toEqual(["id"]);
  });

  it("leaves GalleryUpvote's indexes untouched (task #40 adds none)", async () => {
    const indexes = await indexColumns("GalleryUpvote");
    expect(indexes["GalleryUpvote_userId_galleryItemId_key"]).toEqual([
      "userId",
      "galleryItemId",
    ]);
    expect(indexes["GalleryUpvote_galleryItemId_idx"]).toEqual(["galleryItemId"]);
  });

  // NOT asserted here: `prisma migrate diff --exit-code` (no-drift). It cannot run
  // against this database — DBOS owns an out-of-Prisma `noop_proof` table in the shared
  // dev DB, so the diff is permanently non-empty ("[-] Removed tables - noop_proof") and
  // the assertion would fail for a reason that has nothing to do with the schema. The
  // no-drift proof is run against a PRISTINE scratch database instead (plan §7(a) 3).
});

// Same argument as the block above, for a COLUMN instead of an index: every other
// assertion about `makingOf` in this repo reads text (schema.prisma, migration.sql) or a
// generated type. This asks the running database.
describe("e2e: Turn 16a GalleryItem.makingOf in Postgres", () => {
  it("created makingOf as a NULLABLE jsonb column with no default", async () => {
    const rows = await client.$queryRawUnsafe<
      Array<{ data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'GalleryItem'
          AND column_name = 'makingOf'`,
    );
    expect(
      rows,
      "makingOf missing from the DATABASE (did migrate deploy run?)",
    ).toHaveLength(1);
    expect(rows[0]?.data_type).toBe("jsonb");
    // NOT NULL would break every pre-existing row; a default would turn "never
    // captured" into "captured, and empty".
    expect(rows[0]?.is_nullable).toBe("YES");
    expect(rows[0]?.column_default).toBeNull();
  });

  it("a row written WITHOUT makingOf reads back null (the pre-existing-item case)", async () => {
    const u = await makeUser("mo-null");
    const p = await makeProject(u.id, "making-of-null");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, u.id);
    const gi = await makeGalleryItem(rj.id, p.id, u.id);
    // `makeGalleryItem` does not set the column at all — exactly like every publish that
    // happened before this column existed, and every best-effort capture that failed.
    expect(gi.makingOf).toBeNull();
    const read = await client.galleryItem.findUniqueOrThrow({ where: { id: gi.id } });
    expect(read.makingOf).toBeNull();
  });

  it("round-trips a GalleryMakingOfSchema-valid snapshot through the jsonb column", async () => {
    const snapshot = {
      version: 1 as const,
      capturedAt: "2026-07-26T18:30:00.000Z",
      scriptureText: "In the beginning God created the heaven and the earth.",
      narratorVoiceLabel: "JAMES EARL JONES-STYLE",
      musicStyle: "Ambient cinematic swell",
      captionsOn: true,
      scenes: [
        { index: 1, name: "THE VOID", durationSeconds: 8 },
        { index: 2, name: "LET THERE BE LIGHT", durationSeconds: 7.5 },
      ],
    };
    // The schema is the column's value gate; a snapshot the DB cannot carry must fail
    // validation BEFORE the insert, so the two are proven together here.
    expect(GalleryMakingOfSchema.parse(snapshot)).toEqual(snapshot);

    const u = await makeUser("mo-round");
    const p = await makeProject(u.id, "making-of-round");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, u.id);
    const gi = await makeGalleryItem(rj.id, p.id, u.id);
    await client.galleryItem.update({
      where: { id: gi.id },
      data: { makingOf: snapshot },
    });

    const read = await client.galleryItem.findUniqueOrThrow({ where: { id: gi.id } });
    // Byte-for-byte through jsonb, INCLUDING the fractional duration and the scene ORDER
    // — jsonb does not preserve object key order, but it does preserve ARRAY order, and
    // the scene tiles render in that order.
    expect(GalleryMakingOfSchema.parse(read.makingOf)).toEqual(snapshot);
    expect(
      (read.makingOf as { scenes: Array<{ name: string }> }).scenes.map((s) => s.name),
    ).toEqual(["THE VOID", "LET THERE BE LIGHT"]);
  });

  it("REFUSES a NUL byte in the snapshot — the schema catches what Postgres would reject", async () => {
    // MEASURED: `SELECT ('{"a":"x' || E'\\u0000' || 'y"}')::jsonb` is
    // `ERROR: unsupported Unicode escape sequence`. So this is not a style rule — an
    // ungated NUL is a failed publish INSERT. Proven in both directions: the schema
    // refuses it, and the database refuses it too.
    const withNul = {
      version: 1 as const,
      capturedAt: "2026-07-26T18:30:00.000Z",
      scriptureText: `In the beginning${String.fromCharCode(0)} God created`,
      narratorVoiceLabel: null,
      musicStyle: null,
      captionsOn: false,
      scenes: [],
    };
    expect(GalleryMakingOfSchema.safeParse(withNul).success).toBe(false);

    const u = await makeUser("mo-nul");
    const p = await makeProject(u.id, "making-of-nul");
    const v = await makeVersion(p.id, "0.0.0");
    const rj = await makeRenderJob(p.id, v.id, u.id);
    const gi = await makeGalleryItem(rj.id, p.id, u.id);
    await expect(
      client.galleryItem.update({ where: { id: gi.id }, data: { makingOf: withNul } }),
    ).rejects.toThrow();
  });
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
