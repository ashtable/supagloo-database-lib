import { createSign } from "node:crypto";
import {
  formatGithubRateLimitHeaders,
  isRetryableGithubStatus,
  withGithubRetry,
} from "./github-retry";

/**
 * Shared GitHub App primitives (design-delta §2.3 / §6a / §9-Q1).
 *
 * Supagloo authenticates to GitHub as a **GitHub App with per-repo installation**
 * — it stores only an `installationId` and mints short-lived tokens on demand, so
 * no long-lived repo credential is ever at rest. `database-lib` owns these two
 * primitives (like `secrets.ts` owns `encryptSecret`/`decryptSecret`) so the API
 * (callback verification + live repo listing) and DBOS (git-ops workflows, task
 * 17) sign App JWTs and exchange installation tokens with ONE implementation.
 *
 * House style: the RS256 App JWT is hand-rolled on `node:crypto` (no
 * `jsonwebtoken`/`jose` dependency exists anywhere in this project). GitHub App
 * private keys are PKCS#1 PEM (`-----BEGIN RSA PRIVATE KEY-----`), which
 * `createSign("RSA-SHA256")` signs directly as RS256.
 *
 * These functions are pure/injectable and read NO environment — every input
 * (appId, privateKey, installationId, apiBaseUrl, fetchImpl, now) is passed
 * explicitly by the caller. Nothing here persists a token.
 */

/**
 * The shared GitHub rate-limit retry/backoff primitive (plan row 64, §11.7
 * "one implementation, four consumers"). Re-exported here so every GitHub
 * caller can reach it from the same module it already imports, and through the
 * package barrel for the API and DBOS clients.
 */
export {
  isRetryableGithubStatus,
  githubRetryDelayMs,
  withGithubRetry,
  formatGithubRateLimitHeaders,
  DEFAULT_GITHUB_MAX_ATTEMPTS,
} from "./github-retry";
export type { GithubRetryOptions } from "./github-retry";

/** Discriminates the failure modes of the GitHub App primitives. */
export type GithubAppErrorCode = "TOKEN_EXCHANGE_FAILED" | "RATE_LIMITED";

/**
 * Thrown when an installation-token exchange fails. Carries a machine-readable
 * {@link code} and, when the failure came from a GitHub response, the upstream
 * HTTP {@link upstreamStatus} so callers can classify it without re-parsing a
 * message. The message never includes the signed App JWT.
 *
 * **Why the upstream status is `upstreamStatus` and NOT `status`.** Fastify's default
 * error handler prefers `error.status` over `error.statusCode`
 * (`fastify/lib/error-handler.js`, `setErrorHeaders`: `if (error.status >= 400)
 * statusCode = error.status`, tested BEFORE the `statusCode` branch). A field on a
 * thrown error literally named `status` therefore becomes the HTTP reply code of
 * whatever route the throw escapes through, and the API registers no
 * `setErrorHandler` to intercept it.
 *
 * That is not hypothetical for this class: {@link mintInstallationToken} throws
 * uncaught out of the API's `listInstallationRepos` AND `getRepositoryFileContents`,
 * i.e. out of BOTH `GET /v1/github/repos` and `GET /v1/projects/:id/manifest`. Under
 * the old field name a GitHub **401** on the token exchange (a wrong App credential, a
 * revoked install) was replied as **our own 401** — which tells the caller *its* session
 * is bad and to re-authenticate, an answer indistinguishable from a real expiry, when in
 * fact the caller's session was fine and OUR credential was broken. A 404 likewise
 * became a spurious "not found". Both are infrastructure faults misreported as caller
 * faults.
 *
 * The upstream value therefore lives under a name Fastify does not consume. Same
 * name, for the same reason, as the API's `GithubAppRequestError.upstreamStatus` and
 * `RepoCreationError.upstreamStatus`. This is a wire-level contract; the named
 * "Fastify trap" test in `github.test.ts` is what keeps it renamed.
 *
 * Deliberately NO `statusCode` here either: db-lib is transport-agnostic (DBOS
 * consumes it too), so the API answers 502 at its own route boundaries rather than
 * letting any provider error class dictate an HTTP status from inside a library.
 */
export class GithubAppError extends Error {
  readonly code: GithubAppErrorCode;

  /** Upstream HTTP status, when the failure was an HTTP response. NEVER the status
   *  the API replies — see the class doc-comment. */
  readonly upstreamStatus?: number;

  constructor(
    code: GithubAppErrorCode,
    message: string,
    options?: { cause?: unknown; upstreamStatus?: number },
  ) {
    super(message, options);
    this.name = "GithubAppError";
    this.code = code;
    this.upstreamStatus = options?.upstreamStatus;
  }
}

export interface SignAppJwtOptions {
  /** The GitHub App's numeric ID (issuer claim). */
  appId: string;
  /**
   * The App's RSA private key (PKCS#1 or PKCS#8 PEM). Accepts either real
   * newlines or the documented single-line escaped-`\n` env format — see
   * {@link normalizePemNewlines}.
   */
  privateKey: string;
  /** Injectable clock for deterministic tests; defaults to wall-clock. */
  now?: Date;
  /** Backdate `iat` this many seconds to tolerate clock drift (GitHub's guidance). */
  skewSeconds?: number;
  /** Token lifetime; GitHub's maximum is 600 (10 minutes). */
  ttlSeconds?: number;
}

const base64url = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

/**
 * Restore a PEM whose newlines were escaped to the literal two characters
 * `\` + `n`, so OpenSSL can actually decode it.
 *
 * **Why this exists.** `supagloo/.env.example` defines the deployment contract
 * for `GITHUB_APP_PRIVATE_KEY`:
 *
 * > The private key is the app's PKCS#1/PKCS#8 PEM as a **SINGLE LINE with
 * > escaped `\n`** (**normalized to real newlines before signing**) — e.g.
 * > `-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n`
 *
 * Nothing honoured the "normalized to real newlines before signing" half of
 * that contract: the raw single-line string went straight to
 * `createSign(...).sign()`, which threw
 * `error:1E08010C:DECODER routines::unsupported` (`ERR_OSSL_UNSUPPORTED`) — so
 * a key in the *documented* format broke every GitHub-App-authenticated path
 * (the API's connection verify/install flows, and every DBOS git-ops workflow,
 * which passes `env.GITHUB_APP_PRIVATE_KEY` straight into
 * {@link mintInstallationToken}). Fixed 2026-07-25.
 *
 * This is deliberately the ONE choke point — both consumers reach GitHub
 * through {@link signAppJwt} — rather than duplicated in each service's env
 * loader, which is how it silently went missing in the first place.
 *
 * Both key formats are live in this system, so normalization must be faithful
 * in **both** directions: a PEM that already contains real newlines is returned
 * byte-identical (the escape replacement is simply a no-op on it), so this can
 * be applied unconditionally and can never double-transform a good key.
 */
export function normalizePemNewlines(privateKey: string): string {
  return (
    privateKey
      // Escaped CRLF first, so `\r\n` doesn't leave a stray literal `\r` behind.
      .replace(/\\r\\n|\\n/g, "\n")
      // A genuinely CRLF-delimited PEM decodes fine, but folding it to LF keeps
      // the escaped and real forms byte-identical (and thus signature-identical).
      .replace(/\r\n/g, "\n")
      // Stray whitespace picked up from env plumbing / shell quoting. Node
      // accepts a PEM with no trailing newline, so trimming is safe.
      .trim()
  );
}

/**
 * Sign a short-lived **App JWT** (RS256). Claims follow GitHub's documented
 * pattern: `iat = now − skew` (default 60s back), `exp = now + ttl` (default 600s
 * ahead, the 10-minute max), `iss = appId`; header `{alg:"RS256", typ:"JWT"}`.
 */
export function signAppJwt(opts: SignAppJwtOptions): string {
  const nowSecs = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const skew = opts.skewSeconds ?? 60;
  const ttl = opts.ttlSeconds ?? 600;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iat: nowSecs - skew, exp: nowSecs + ttl, iss: opts.appId };
  const signingInput = `${base64url(header)}.${base64url(claims)}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  // See {@link normalizePemNewlines}: the documented env format is a SINGLE
  // LINE with escaped `\n`, which OpenSSL cannot decode as-is.
  const signature = signer
    .sign(normalizePemNewlines(opts.privateKey))
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

export interface MintInstallationTokenOptions {
  appId: string;
  privateKey: string;
  installationId: string;
  /** REST API base (e.g. `https://api.github.com`; a stub URL in tests). */
  apiBaseUrl: string;
  /** Injectable for unit tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock passed through to {@link signAppJwt}. */
  now?: Date;
  /**
   * Injectable sleep for the bounded rate-limit backoff (plan row 64). Defaults
   * to a real timer; unit lanes pass a no-op spy so nothing actually waits.
   */
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Attempt budget for the rate-limit backoff, including the first attempt.
   * Defaults to {@link DEFAULT_GITHUB_MAX_ATTEMPTS} (4); `1` disables retry.
   */
  maxAttempts?: number;
}

/** The minted, short-lived installation token — returned to the caller, never
 *  persisted by this module. */
export interface InstallationToken {
  token: string;
  expiresAt: Date;
  permissions?: Record<string, string>;
  repositorySelection?: string;
}

/**
 * Sign an App JWT and exchange it for a **~1-hour installation token** scoped to
 * the installation's granted repos (`POST /app/installations/{id}/access_tokens`).
 * The returned token is meant to be used immediately and discarded — this module
 * never stores it, and every call performs a fresh exchange (no caching).
 *
 * A throttled exchange (`429`, or the secondary-limit `403 + Retry-After`) is
 * retried in-process by {@link withGithubRetry}, honouring GitHub's own delay
 * with a bounded, capped budget (plan row 64 / D64.1). A 2xx never enters the
 * retry loop, so the no-caching call counts above are unaffected.
 *
 * @throws {GithubAppError} `RATE_LIMITED` when a throttle never cleared within
 *   the attempt budget (the message carries GitHub's headers verbatim), else
 *   `TOKEN_EXCHANGE_FAILED`. Both carry the upstream status as `upstreamStatus`
 *   (never `status` — see the {@link GithubAppError} doc-comment).
 */
export async function mintInstallationToken(
  opts: MintInstallationTokenOptions,
): Promise<InstallationToken> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const jwt = signAppJwt({
    appId: opts.appId,
    privateKey: opts.privateKey,
    now: opts.now,
  });
  const url = `${opts.apiBaseUrl.replace(/\/+$/, "")}/app/installations/${
    opts.installationId
  }/access_tokens`;

  const res = await withGithubRetry(
    () =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
        },
      }),
    { sleepImpl: opts.sleepImpl, maxAttempts: opts.maxAttempts },
  );
  if (!res.ok) {
    // Retryable is not the same as throttled: a 5xx that never clears is an
    // upstream failure, not a rate limit.
    const throttled =
      (res.status === 429 || res.status === 403) &&
      isRetryableGithubStatus(res.status, res.headers);
    const headerNote = formatGithubRateLimitHeaders(res.headers);
    throw new GithubAppError(
      throttled ? "RATE_LIMITED" : "TOKEN_EXCHANGE_FAILED",
      // Never interpolate the JWT — see the `Bearer` regression test.
      `installation token exchange ${
        throttled ? "was rate-limited" : "failed"
      } for installation ${opts.installationId}: ${res.status}${
        headerNote ? ` (${headerNote})` : ""
      }`,
      { upstreamStatus: res.status },
    );
  }

  const body = (await res.json()) as {
    token?: string;
    expires_at?: string;
    permissions?: Record<string, string>;
    repository_selection?: string;
  };
  if (!body.token || !body.expires_at) {
    throw new GithubAppError(
      "TOKEN_EXCHANGE_FAILED",
      `installation token exchange returned an unexpected body for installation ${opts.installationId}`,
    );
  }

  return {
    token: body.token,
    expiresAt: new Date(body.expires_at),
    permissions: body.permissions,
    repositorySelection: body.repository_selection,
  };
}
