import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  decryptSecret,
  encryptSecret,
  SecretCryptoError,
} from "../../src/index";

// End-to-end proof of the secrets primitive (design-delta §2.10) against the real
// Compose Postgres: encrypt a secret, persist the ciphertext into a real
// connection row, read it back, and decrypt. Asserts the value AT REST is never
// the plaintext. Precondition: Postgres reachable at DATABASE_URL —
// `docker compose up -d postgres` from /Users/ash/code/supagloo.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://supagloo:supagloo@localhost:5432/supagloo";

// Real code reads SECRETS_ENCRYPTION_KEY at the app edge and passes it in; the
// e2e test does the same, with a fixed dev fallback (mirrors the DATABASE_URL
// fallback above). 64 hex chars = 32 bytes.
const KEY =
  process.env.SECRETS_ENCRYPTION_KEY ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// A second, distinct valid key to prove the at-rest bytes are genuinely key-bound.
const OTHER_KEY = randomBytes(32).toString("hex");

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

describe("e2e: secrets encryption against Compose Postgres", () => {
  it("persists an encrypted OpenRouter api key and decrypts it back", async () => {
    const plaintext = `sk-or-v1-${randomUUID().replace(/-/g, "")}`;
    const ciphertext = encryptSecret(plaintext, KEY);
    const user = await makeUser("or");

    await client.openRouterConnection.create({
      data: {
        userId: user.id,
        apiKeyCiphertext: ciphertext,
        keyLast4: plaintext.slice(-4),
        status: "connected",
      },
    });

    // Read the row back through Prisma.
    const row = await client.openRouterConnection.findUnique({
      where: { userId: user.id },
    });
    expect(row).not.toBeNull();
    expect(row?.apiKeyCiphertext).toBe(ciphertext);
    // The value AT REST is never the plaintext.
    expect(row?.apiKeyCiphertext).not.toBe(plaintext);

    // Belt-and-braces: the raw column text does not contain the plaintext.
    const raw = await client.$queryRawUnsafe<
      Array<{ apiKeyCiphertext: string }>
    >(
      `SELECT "apiKeyCiphertext" FROM "OpenRouterConnection" WHERE "userId" = $1`,
      user.id,
    );
    expect(raw[0]?.apiKeyCiphertext).toBe(ciphertext);
    expect(raw[0]?.apiKeyCiphertext.includes(plaintext)).toBe(false);

    // Decrypting the stored ciphertext yields the original plaintext.
    expect(decryptSecret(row!.apiKeyCiphertext, KEY)).toBe(plaintext);
  });

  it("persists an encrypted Gloo client secret and decrypts it back", async () => {
    const plaintext = `gloo_secret_${randomUUID().replace(/-/g, "")}`;
    const ciphertext = encryptSecret(plaintext, KEY);
    const user = await makeUser("gloo");

    await client.glooConnection.create({
      data: {
        userId: user.id,
        clientId: "client_public_id",
        clientSecretCiphertext: ciphertext,
        status: "connected",
      },
    });

    const row = await client.glooConnection.findUnique({
      where: { userId: user.id },
    });
    expect(row).not.toBeNull();
    expect(row?.clientSecretCiphertext).not.toBe(plaintext);
    // The public clientId is stored plaintext; only the secret is ciphertext.
    expect(row?.clientId).toBe("client_public_id");
    expect(decryptSecret(row!.clientSecretCiphertext, KEY)).toBe(plaintext);
  });

  it("at-rest ciphertext is key-bound (wrong key fails authentication)", async () => {
    const plaintext = "provider-secret-value";
    const ciphertext = encryptSecret(plaintext, KEY);
    const user = await makeUser("keybound");

    await client.openRouterConnection.create({
      data: {
        userId: user.id,
        apiKeyCiphertext: ciphertext,
        keyLast4: plaintext.slice(-4),
        status: "connected",
      },
    });

    const row = await client.openRouterConnection.findUnique({
      where: { userId: user.id },
    });

    let thrown: unknown;
    try {
      decryptSecret(row!.apiKeyCiphertext, OTHER_KEY);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SecretCryptoError);
    expect((thrown as SecretCryptoError).code).toBe("AUTH_FAILED");
  });
});
