import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signAppJwt,
  mintInstallationToken,
  GithubAppError,
} from "./github";

// Unit tests for the shared GitHub App primitives (design-delta §2.3 / §6a /
// §9-Q1). db-lib owns these so the API (callback verify + repo listing) and DBOS
// (task 17 git-ops) sign the App JWT and mint installation tokens the same way.
// Hand-rolled RS256 on node:crypto (house style — no jsonwebtoken/jose dep). No
// network: mintInstallationToken takes an INJECTED fetch.

// A real RSA keypair shaped exactly like a GitHub App private key (PKCS#1 PEM).
const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  },
);

const APP_ID = "123456";
const NOW = new Date("2026-07-18T12:00:00.000Z");
const NOW_SECS = Math.floor(NOW.getTime() / 1000);

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response,
): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
}

function decodeJwt(jwt: string): {
  header: any;
  claims: any;
  signingInput: string;
  signature: Buffer;
} {
  const [h, c, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
    claims: JSON.parse(Buffer.from(c, "base64url").toString("utf8")),
    signingInput: `${h}.${c}`,
    signature: Buffer.from(s, "base64url"),
  };
}

describe("signAppJwt", () => {
  it("builds an RS256 JWT with GitHub's iat/exp/iss claim shape", () => {
    const jwt = signAppJwt({
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      now: NOW,
    });
    const { header, claims } = decodeJwt(jwt);

    expect(jwt.split(".")).toHaveLength(3);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims.iss).toBe(APP_ID);
    // iat backdated 60s for clock skew; exp is 10 minutes from now.
    expect(claims.iat).toBe(NOW_SECS - 60);
    expect(claims.exp).toBe(NOW_SECS + 600);
    expect(claims.exp - claims.iat).toBe(660);
  });

  it("produces a signature that verifies against the public key", () => {
    const jwt = signAppJwt({ appId: APP_ID, privateKey: PRIVATE_KEY, now: NOW });
    const { signingInput, signature } = decodeJwt(jwt);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    expect(verifier.verify(PUBLIC_KEY, signature)).toBe(true);
  });

  it("honours injected skew/ttl overrides", () => {
    const jwt = signAppJwt({
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      now: NOW,
      skewSeconds: 0,
      ttlSeconds: 120,
    });
    const { claims } = decodeJwt(jwt);
    expect(claims.iat).toBe(NOW_SECS);
    expect(claims.exp).toBe(NOW_SECS + 120);
  });
});

describe("mintInstallationToken", () => {
  const OK = {
    token: "ghs_stub_inst_42_1",
    expires_at: "2026-07-18T13:00:00.000Z",
    permissions: { contents: "write" },
    repository_selection: "selected",
  };

  it("exchanges an App JWT for an installation token (never persisted)", async () => {
    const seen: { url: string; auth?: string; method?: string }[] = [];
    const result = await mintInstallationToken({
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      installationId: "42",
      apiBaseUrl: "https://api.github.com",
      now: NOW,
      fetchImpl: fakeFetch((url, init) => {
        const headers = new Headers(init?.headers);
        seen.push({
          url,
          auth: headers.get("authorization") ?? undefined,
          method: init?.method,
        });
        return new Response(JSON.stringify(OK), { status: 201 });
      }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe(
      "https://api.github.com/app/installations/42/access_tokens",
    );
    // Authenticated with a well-formed App JWT (not an installation token).
    expect(seen[0].auth?.startsWith("Bearer ")).toBe(true);
    const jwt = seen[0].auth!.slice("Bearer ".length);
    expect(decodeJwt(jwt).claims.iss).toBe(APP_ID);

    expect(result.token).toBe("ghs_stub_inst_42_1");
    expect(result.expiresAt).toEqual(new Date("2026-07-18T13:00:00.000Z"));
  });

  it("mints fresh per call — no caching/persistence between calls", async () => {
    let n = 0;
    const fetchImpl = fakeFetch(() => {
      n += 1;
      return new Response(
        JSON.stringify({ ...OK, token: `ghs_tok_${n}` }),
        { status: 201 },
      );
    });
    const args = {
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      installationId: "42",
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    };
    const a = await mintInstallationToken(args);
    const b = await mintInstallationToken(args);
    expect(n).toBe(2); // one exchange per call — nothing cached
    expect(a.token).not.toBe(b.token);
  });

  it("throws GithubAppError on a 401/404 exchange (JWT not leaked in message)", async () => {
    const call = mintInstallationToken({
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      installationId: "42",
      apiBaseUrl: "https://api.github.com",
      fetchImpl: fakeFetch(
        () => new Response(JSON.stringify({ message: "Bad" }), { status: 401 }),
      ),
    });
    await expect(call).rejects.toBeInstanceOf(GithubAppError);
    await call.catch((err: GithubAppError) => {
      expect(err.code).toBeTypeOf("string");
      expect(err.message).not.toContain("Bearer");
    });
  });
});
