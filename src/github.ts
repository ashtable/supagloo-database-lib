import { createSign } from "node:crypto";

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

/** Discriminates the failure modes of the GitHub App primitives. */
export type GithubAppErrorCode = "TOKEN_EXCHANGE_FAILED";

/**
 * Thrown when an installation-token exchange fails. Carries a machine-readable
 * {@link code}. The message never includes the signed App JWT.
 */
export class GithubAppError extends Error {
  readonly code: GithubAppErrorCode;

  constructor(
    code: GithubAppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GithubAppError";
    this.code = code;
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
 * @throws {GithubAppError} `TOKEN_EXCHANGE_FAILED` on a non-2xx exchange.
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

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new GithubAppError(
      "TOKEN_EXCHANGE_FAILED",
      `installation token exchange failed for installation ${opts.installationId}: ${res.status}`,
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
