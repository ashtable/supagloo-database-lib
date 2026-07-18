import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  GeneratedStoryboardSchema,
  MusicSpecSchema,
  NarrationSpecSchema,
} from "../../src/index";

// End-to-end proof that the Task #7 domain Zod schemas (design-delta §2.11) survive
// a real Postgres Json-column round-trip. The ONLY Zod-shaped JSON that persists in
// Prisma columns is AiGeneration.input / AiGeneration.resultJson (§2.11 closing
// note), so those are the targets: persist a schema-shaped object, read it back
// through Prisma, and re-parse the fetched JSON through the schema (not a raw
// toEqual). Also proves the schema is a real GATE over persisted JSON (a malformed
// row fails safeParse). Precondition: Compose Postgres reachable at DATABASE_URL —
// `docker compose up -d postgres` from /Users/ash/code/supagloo.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://supagloo:supagloo@localhost:5432/supagloo";

const RUN = `test-${randomUUID()}`;

let client: ReturnType<typeof createPrismaClient>;

async function makeUser(tag: string) {
  return client.user.create({
    data: {
      youversionUserId: `${RUN}-${tag}`,
      displayName: `User ${tag}`,
      email: `${tag}@example.com`,
      avatarInitials: "US",
    },
  });
}

// Caller-supplied workflow-id PK (AiGeneration), namespaced to this run so cascade
// cleanup via the owning user removes it.
function rid(tag: string): string {
  return `${RUN}-${tag}-${randomUUID()}`;
}

const storyboard = {
  scenes: [
    {
      name: "wilderness · dawn",
      scriptText: "I am the voice of one",
      reference: "JOHN 1:23",
      translation: "KJV",
      visualPrompt: "sweeping empty wilderness at first light",
      suggestedDurationSeconds: 5,
    },
    {
      name: "verse card",
      scriptText: "John 1:23 · KJV",
      reference: "JOHN 1:23",
      translation: "BSB",
      visualPrompt: "elegant scripture verse card, dark parchment",
      suggestedDurationSeconds: 8,
    },
  ],
  narratorVoice: {
    description: "warm, weathered baritone, unhurried and reverent",
    label: "JAMES EARL JONES-STYLE",
  },
  musicStyle: "Swelling strings",
};

const narrationSpec = {
  voice: { description: "warm, weathered baritone", label: "JEJ-STYLE" },
  scenes: [
    { sceneId: "s1", scriptText: "I am the voice of one" },
    { sceneId: "s2", scriptText: "of one crying in the wilderness," },
  ],
};

const musicSpec = { style: "Swelling strings", durationSeconds: 30 };

beforeAll(async () => {
  client = createPrismaClient({ connectionString: DATABASE_URL });

  try {
    await client.$queryRawUnsafe("SELECT 1");
  } catch (err) {
    throw new Error(
      `Compose Postgres not reachable at ${DATABASE_URL}. ` +
        "Run `docker compose up -d postgres` from /Users/ash/code/supagloo. " +
        `Underlying error: ${String(err)}`,
    );
  }

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

describe("e2e: domain Zod schemas round-trip through Postgres Json columns", () => {
  it("persists a GeneratedStoryboard in AiGeneration.resultJson and re-parses it", async () => {
    // Only ever persist validated data.
    const valid = GeneratedStoryboardSchema.parse(storyboard);
    const user = await makeUser("storyboard");

    const gen = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: user.id,
        kind: "storyboard",
        provider: "openrouter", // storyboard accepts gloo | openrouter (§2.8)
        model: "some/model",
        input: { passage: "John 1:23", translation: "KJV" },
        status: "succeeded",
        resultJson: valid,
      },
    });

    const row = await client.aiGeneration.findUnique({ where: { id: gen.id } });
    expect(row?.resultJson).not.toBeNull();

    const parsed = GeneratedStoryboardSchema.safeParse(row?.resultJson);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(storyboard);
  });

  it("persists a NarrationSpec in AiGeneration.input and re-parses it", async () => {
    const valid = NarrationSpecSchema.parse(narrationSpec);
    const user = await makeUser("narration");

    const gen = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: user.id,
        kind: "narration",
        provider: "openrouter", // media kinds are openrouter-only (§2.8)
        model: "some/tts-model",
        input: valid,
        status: "queued",
      },
    });

    const row = await client.aiGeneration.findUnique({ where: { id: gen.id } });
    const parsed = NarrationSpecSchema.safeParse(row?.input);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(narrationSpec);
  });

  it("persists a MusicSpec in AiGeneration.input and re-parses it", async () => {
    const valid = MusicSpecSchema.parse(musicSpec);
    const user = await makeUser("music");

    const gen = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: user.id,
        kind: "music",
        provider: "openrouter",
        model: "some/music-model",
        input: valid,
        status: "queued",
      },
    });

    const row = await client.aiGeneration.findUnique({ where: { id: gen.id } });
    const parsed = MusicSpecSchema.safeParse(row?.input);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(musicSpec);
  });

  it("acts as a real gate: a malformed persisted resultJson fails safeParse", async () => {
    // Bypass the Zod gate to simulate corrupt/legacy data: a storyboard whose scene
    // translation is "NIV" (outside KJV | BSB). This is the §8 line-875 scenario.
    const malformed = {
      ...storyboard,
      scenes: [{ ...storyboard.scenes[0], translation: "NIV" }],
    };
    const user = await makeUser("malformed");

    const gen = await client.aiGeneration.create({
      data: {
        id: rid("aig"),
        userId: user.id,
        kind: "storyboard",
        provider: "openrouter",
        model: "some/model",
        input: {},
        status: "succeeded",
        resultJson: malformed,
      },
    });

    const row = await client.aiGeneration.findUnique({ where: { id: gen.id } });
    expect(row?.resultJson).not.toBeNull();
    expect(GeneratedStoryboardSchema.safeParse(row?.resultJson).success).toBe(false);
  });
});
