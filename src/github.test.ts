import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

// ---------------------------------------------------------------------------
// Private-key newline normalization — regression tests for a production bug
// found 2026-07-25.
//
// `supagloo/.env.example` documents GITHUB_APP_PRIVATE_KEY as the PEM on a
// SINGLE LINE with escaped `\n`, "normalized to real newlines before signing".
// Nothing normalized it here, so a key in the documented format reached OpenSSL
// as one unbroken line and threw `ERR_OSSL_UNSUPPORTED`
// (`error:1E08010C:DECODER routines::unsupported`) — breaking every
// GitHub-App-authenticated path. Most acutely DBOS: all of its git-ops
// workflows pass `env.GITHUB_APP_PRIVATE_KEY` straight into
// `mintInstallationToken`, so `scaffoldProjectWorkflow` died after exhausting
// its retries.
//
// The escaped and real-newline forms are BOTH live in this system, so the
// normalization has to be faithful in both directions — hence the
// identical-signature test below, not merely "it didn't throw".
// ---------------------------------------------------------------------------

/** The same key as PRIVATE_KEY, in the single-line escaped-`\n` env format. */
const ESCAPED_PRIVATE_KEY = PRIVATE_KEY.replace(/\n/g, "\\n");

function verifyJwt(jwt: string): boolean {
  const { signingInput, signature } = decodeJwt(jwt);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  return verifier.verify(PUBLIC_KEY, signature);
}

describe("signAppJwt private-key newline normalization", () => {
  it("signs a PEM in the documented single-line escaped-\\n form, and the signature VERIFIES", () => {
    // Guard the fixture itself: this really is one unbroken line.
    expect(ESCAPED_PRIVATE_KEY).not.toContain("\n");
    expect(ESCAPED_PRIVATE_KEY).toContain("\\n");

    const jwt = signAppJwt({
      appId: APP_ID,
      privateKey: ESCAPED_PRIVATE_KEY,
      now: NOW,
    });

    expect(verifyJwt(jwt)).toBe(true);
  });

  it("still signs a PEM that already has REAL newlines (pass-through regression guard)", () => {
    // This form is live too — every other unit test here, and the api service's
    // container env, supply a real multi-line PEM. Normalization must not
    // double-transform or corrupt it.
    const jwt = signAppJwt({ appId: APP_ID, privateKey: PRIVATE_KEY, now: NOW });

    expect(verifyJwt(jwt)).toBe(true);
  });

  it("produces an IDENTICAL signature from both forms of the same key", () => {
    const fromEscaped = signAppJwt({
      appId: APP_ID,
      privateKey: ESCAPED_PRIVATE_KEY,
      now: NOW,
    });
    const fromReal = signAppJwt({
      appId: APP_ID,
      privateKey: PRIVATE_KEY,
      now: NOW,
    });

    // Same claims ⇒ same signing input, and RS256 (PKCS#1 v1.5) is
    // deterministic — so a faithful, lossless normalization must yield the very
    // same JWT. This is what proves the two forms are the SAME key, rather than
    // both merely happening to parse.
    expect(fromEscaped).toBe(fromReal);
    expect(verifyJwt(fromEscaped)).toBe(true);
  });

  it("tolerates the escaped-CRLF (\\r\\n) form without leaving a stray \\r", () => {
    const escapedCrlf = PRIVATE_KEY.trimEnd().replace(/\n/g, "\\r\\n");
    expect(escapedCrlf).not.toContain("\n");

    const jwt = signAppJwt({
      appId: APP_ID,
      privateKey: escapedCrlf,
      now: NOW,
    });

    expect(verifyJwt(jwt)).toBe(true);
  });

  it("tolerates stray surrounding whitespace and extra trailing newlines", () => {
    const messy = `  \n${ESCAPED_PRIVATE_KEY}\\n\n  `;

    const jwt = signAppJwt({ appId: APP_ID, privateKey: messy, now: NOW });

    expect(verifyJwt(jwt)).toBe(true);
    // Still the same key — whitespace tolerance must not change the signature.
    expect(jwt).toBe(
      signAppJwt({ appId: APP_ID, privateKey: PRIVATE_KEY, now: NOW }),
    );
  });

  it("still rejects a genuinely malformed key instead of silently 'fixing' it", () => {
    expect(() =>
      signAppJwt({ appId: APP_ID, privateKey: "not-a-pem-at-all", now: NOW }),
    ).toThrow();
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

  it("exchanges with a single-line escaped-\\n PEM — the exact DBOS failure path", async () => {
    // Every dbos git-ops workflow passes `env.GITHUB_APP_PRIVATE_KEY` (the
    // documented escaped form) straight into this function. Before
    // normalization this threw ERR_OSSL_UNSUPPORTED inside signAppJwt, so the
    // exchange never even reached the network and DBOS burned all 4 retries.
    const seen: string[] = [];
    const result = await mintInstallationToken({
      appId: APP_ID,
      privateKey: ESCAPED_PRIVATE_KEY,
      installationId: "42",
      apiBaseUrl: "https://api.github.com",
      now: NOW,
      fetchImpl: fakeFetch((_url, init) => {
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        seen.push(auth.slice("Bearer ".length));
        return new Response(JSON.stringify(OK), { status: 201 });
      }),
    });

    expect(result.token).toBe("ghs_stub_inst_42_1");
    // The App JWT it sent is genuinely signed by that key.
    expect(seen).toHaveLength(1);
    expect(verifyJwt(seen[0])).toBe(true);
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

// ---------------------------------------------------------------------------
// Rate-limit handling (plan row 64, D64.1/D64.2/D64.4/D64.6).
//
// GitHub's SECONDARY (abuse) limits are account-scoped and far tighter than the
// core limit; they arrive as `403 + Retry-After` (typically 60s), while the
// primary limit arrives as `429`. D64.1: the CLIENT sleeps, because the DBOS
// step budget (maxAttempts 4, intervalSeconds 1, backoffRate 2 => ~7s total)
// cannot honour a 60s Retry-After — so `isPermanentHttpStatus` keeps 403
// permanent and the two retry layers never multiply.
//
// Every sleep is INJECTED, so this suite never actually waits.
// ---------------------------------------------------------------------------

describe("mintInstallationToken — rate-limit handling (row 64)", () => {
  const OK = {
    token: "ghs_stub_inst_42_1",
    expires_at: "2026-07-18T13:00:00.000Z",
  };

  const baseArgs = {
    appId: APP_ID,
    privateKey: PRIVATE_KEY,
    installationId: "42",
    apiBaseUrl: "https://api.github.com",
    now: NOW,
  };

  it("retries a 403 + Retry-After, honouring the delay, then succeeds", async () => {
    const sleepImpl = vi.fn(async () => {});
    let n = 0;
    const result = await mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      fetchImpl: fakeFetch(() => {
        n += 1;
        if (n === 1) {
          return new Response(JSON.stringify({ message: "slow down" }), {
            status: 403,
            headers: { "retry-after": "1" },
          });
        }
        return new Response(JSON.stringify(OK), { status: 201 });
      }),
    });

    expect(n).toBe(2);
    expect(sleepImpl.mock.calls).toEqual([[1_000]]);
    expect(result.token).toBe("ghs_stub_inst_42_1");
  });

  it("backs off a 429 using x-ratelimit-reset, capped at 60s", async () => {
    const sleepImpl = vi.fn(async () => {});
    // Two hours out: the raw delta is 7_200_000ms, which the cap must clamp.
    const reset = Math.floor(Date.now() / 1000) + 7200;
    let n = 0;
    const result = await mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      fetchImpl: fakeFetch(() => {
        n += 1;
        if (n === 1) {
          return new Response(JSON.stringify({ message: "rate limited" }), {
            status: 429,
            headers: { "x-ratelimit-reset": String(reset) },
          });
        }
        return new Response(JSON.stringify(OK), { status: 201 });
      }),
    });

    expect(n).toBe(2);
    expect(sleepImpl.mock.calls).toEqual([[60_000]]);
    expect(result.token).toBe("ghs_stub_inst_42_1");
  });

  it("gives up after maxAttempts and surfaces the Retry-After header verbatim as RATE_LIMITED", async () => {
    const sleepImpl = vi.fn(async () => {});
    let n = 0;
    const call = mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      maxAttempts: 3,
      fetchImpl: fakeFetch(() => {
        n += 1;
        return new Response(JSON.stringify({ message: "abuse detection" }), {
          status: 403,
          headers: { "retry-after": "60" },
        });
      }),
    });

    await expect(call).rejects.toBeInstanceOf(GithubAppError);
    await call.catch((err: GithubAppError) => {
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.upstreamStatus).toBe(403);
      expect(err.message).toContain("60");
      // The JWT-leak property of `:284-299` must survive the rewritten path.
      expect(err.message).not.toContain("Bearer");
    });
    expect(n).toBe(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a bare permission-denial 403, and carries the status", async () => {
    const sleepImpl = vi.fn(async () => {});
    let n = 0;
    const call = mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      fetchImpl: fakeFetch(() => {
        n += 1;
        return new Response(JSON.stringify({ message: "Resource not accessible" }), {
          status: 403,
        });
      }),
    });

    await expect(call).rejects.toBeInstanceOf(GithubAppError);
    await call.catch((err: GithubAppError) => {
      expect(err.code).toBe("TOKEN_EXCHANGE_FAILED");
      expect(err.upstreamStatus).toBe(403);
      expect(err.message).not.toContain("Bearer");
    });
    expect(n).toBe(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("never retries a 401 or a 422, and carries the status on both", async () => {
    for (const status of [401, 422]) {
      const sleepImpl = vi.fn(async () => {});
      let n = 0;
      const call = mintInstallationToken({
        ...baseArgs,
        sleepImpl,
        fetchImpl: fakeFetch(() => {
          n += 1;
          return new Response(JSON.stringify({ message: "nope" }), { status });
        }),
      });

      await expect(call).rejects.toBeInstanceOf(GithubAppError);
      await call.catch((err: GithubAppError) => {
        expect(err.code).toBe("TOKEN_EXCHANGE_FAILED");
        expect(err.upstreamStatus).toBe(status);
      });
      expect(n).toBe(1);
      expect(sleepImpl).not.toHaveBeenCalled();
    }
  });

  it("classifies an unclearing 5xx as TOKEN_EXCHANGE_FAILED, not RATE_LIMITED", async () => {
    // Retryable is not the same as throttled: only 429, and a 403 carrying
    // rate-limit headers, are rate limits. A 502 that never clears is an
    // upstream failure and must say so.
    const sleepImpl = vi.fn(async () => {});
    let n = 0;
    const call = mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      maxAttempts: 2,
      fetchImpl: fakeFetch(() => {
        n += 1;
        return new Response("upstream boom", { status: 502 });
      }),
    });

    await expect(call).rejects.toBeInstanceOf(GithubAppError);
    await call.catch((err: GithubAppError) => {
      expect(err.code).toBe("TOKEN_EXCHANGE_FAILED");
      expect(err.upstreamStatus).toBe(502);
    });
    expect(n).toBe(2);
  });

  it("retries a 5xx and reaches the token", async () => {
    const sleepImpl = vi.fn(async () => {});
    let n = 0;
    const result = await mintInstallationToken({
      ...baseArgs,
      sleepImpl,
      fetchImpl: fakeFetch(() => {
        n += 1;
        if (n < 3) {
          return new Response("upstream boom", { status: 502 });
        }
        return new Response(JSON.stringify(OK), { status: 201 });
      }),
    });

    expect(n).toBe(3);
    // No throttle headers => the exponential fallback, 500 then 1000.
    expect(sleepImpl.mock.calls).toEqual([[500], [1_000]]);
    expect(result.token).toBe("ghs_stub_inst_42_1");
  });

  it("carries the upstream status as `upstreamStatus` and NEVER as `status` (Fastify trap)", async () => {
    // Fastify's default error handler prefers `error.status` over `error.statusCode`
    // (`fastify/lib/error-handler.js` `setErrorHeaders`: `if (error.status >= 400)
    // statusCode = error.status`, checked BEFORE the `statusCode` branch). A field on a
    // thrown error literally named `status` therefore becomes the HTTP reply code of
    // whatever route the throw escapes through.
    //
    // `mintInstallationToken` throws uncaught out of the API's `listInstallationRepos`
    // AND `getRepositoryFileContents`, i.e. out of BOTH `GET /v1/github/repos` and
    // `GET /v1/projects/:id/manifest`. With a field named `status`, a GitHub 401 on the
    // token exchange (our App credential is wrong / the install was revoked) replied
    // **401 to the browser** — telling the caller to re-authenticate, indistinguishable
    // from a real session expiry, when the caller's session was fine and OURS was
    // broken. A 404 likewise became a spurious "not found".
    //
    // The upstream value therefore lives under a name Fastify does not consume. Same
    // name, for the same reason, as the API's `GithubAppRequestError.upstreamStatus`
    // and `RepoCreationError.upstreamStatus`. This is a WIRE-LEVEL contract, not a
    // cosmetic one: if anyone renames it back, this assertion is what stops them.
    for (const status of [401, 404, 500]) {
      const call = mintInstallationToken({
        ...baseArgs,
        sleepImpl: vi.fn(async () => {}),
        maxAttempts: 1,
        fetchImpl: fakeFetch(
          () => new Response(JSON.stringify({ message: "nope" }), { status }),
        ),
      });
      await expect(call).rejects.toBeInstanceOf(GithubAppError);
      await call.catch((err: GithubAppError) => {
        expect(err.upstreamStatus).toBe(status);
        expect((err as unknown as { status?: number }).status).toBeUndefined();
      });
    }
  });
});
