/**
 * Shared GitHub rate-limit retry/backoff primitive (design-delta §11.7 —
 * "one implementation, four consumers"; plan row 64).
 *
 * **Why this lives in db-lib.** All four GitHub callers in the platform — this
 * module's own `mintInstallationToken`, the API's App client, the DBOS git-ops
 * REST client, and `publish-version`'s tag creator — face the same GitHub
 * throttling behaviour, and a divergent backoff in any one of them is invisible
 * until it costs a real workflow. db-lib is where the shared primitives live
 * (like `secrets.ts` and `s3-keys.ts`), so this is the one implementation.
 *
 * **It is a PORT, not an import.** The reference implementation is the root
 * e2e harness (`supagloo/tests/support/e2e-github-api.mjs`, `retryDelayMs` /
 * `isRetryable`), which is TEST code — the product must never depend on it. The
 * two are kept semantically identical on purpose: if they ever disagree, the
 * harness and the product are honouring GitHub differently.
 *
 * **The two-layer rule (D64.1).** The CLIENT sleeps here, in-process, honouring
 * `Retry-After` / `x-ratelimit-reset` with a bounded, capped backoff. The DBOS
 * step classifier keeps `403 => permanent` (`scaffold-project/github-rest.ts`
 * `isPermanentHttpStatus`) so the two retry layers never multiply — a DBOS step
 * budget of `{maxAttempts: 4, intervalSeconds: 1, backoffRate: 2}` is ~7s total
 * and structurally cannot honour a typical 60s secondary-limit `Retry-After`.
 *
 * **What is retryable.** `429` (primary limit) and `5xx` always; `403` only when
 * it carries a throttle signal, because GitHub returns the *secondary* (abuse)
 * limit as `403 + Retry-After` while a bare `403` is a permission denial that
 * will never clear — and the installation deliberately holds no `administration`
 * scope (§11.3), so genuine 403s are expected behaviour. `422` is NEVER retried:
 * it is a real conflict (a duplicate repo name, an unborn base ref) and a retry
 * loop would only mask the bug.
 *
 * Pure and injectable: reads no environment, opens no socket, and takes its
 * clock and its sleep from the caller, so unit lanes never actually wait.
 */

/** Header-derived delays (`Retry-After`, `x-ratelimit-reset`) are capped here.
 *  D64.6: a long in-process sleep keeps a `ProjectJob` in `running` for longer,
 *  widening the window in which a retry-from-UI hits the §2.9 409 git-ops guard. */
const MAX_HEADER_DELAY_MS = 60_000;

/** The blind exponential fallback is capped tighter — it is a guess, not a
 *  server instruction. (Exact parity with the root harness.) */
const MAX_BACKOFF_DELAY_MS = 30_000;

const BASE_BACKOFF_MS = 500;

/** Bounded by design: a retry budget that is not bounded is an outage. */
export const DEFAULT_GITHUB_MAX_ATTEMPTS = 4;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Is this GitHub response status worth another attempt?
 *
 * `429` | `5xx` | (`403` AND (`Retry-After` present OR `x-ratelimit-remaining`
 * exhausted)). Everything else — notably `422`, `404` and a bare `403` — is
 * deterministic and must surface immediately.
 */
export function isRetryableGithubStatus(
  status: number,
  headers: Headers,
): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  if (status === 403) {
    return (
      headers.get("retry-after") !== null ||
      headers.get("x-ratelimit-remaining") === "0"
    );
  }
  return false;
}

/**
 * How long to wait before the next attempt, in milliseconds.
 *
 * Preference order: GitHub's own `Retry-After` (seconds) => the
 * `x-ratelimit-reset` delta (epoch seconds) => a blind exponential backoff of
 * `500 * 2^(attempt-1)`. Header-derived delays are capped at 60s and the blind
 * fallback at 30s.
 *
 * @param attempt 1-based index of the attempt that just failed.
 * @param nowMs   injectable clock (epoch ms) for deterministic tests.
 */
export function githubRetryDelayMs(
  headers: Headers,
  attempt: number,
  nowMs: number = Date.now(),
): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    // GitHub sends integer seconds. The HTTP-date form is legal but GitHub does
    // not use it, and guessing at it is worse than falling through.
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_HEADER_DELAY_MS);
    }
  }

  const reset = headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const resetSecs = Number(reset);
    if (Number.isFinite(resetSecs)) {
      const delta = resetSecs * 1000 - nowMs;
      // A reset already in the past tells us nothing — fall through.
      if (delta > 0) return Math.min(delta, MAX_HEADER_DELAY_MS);
    }
  }

  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_DELAY_MS);
}

/**
 * Render GitHub's throttle headers for an error message, VERBATIM.
 *
 * D64.2: the header value is surfaced so an operator can see what GitHub asked
 * for — and is never asserted on by a product test, because a suite that
 * asserts on a live throttle value is a flake factory.
 */
export function formatGithubRateLimitHeaders(headers: Headers): string {
  const parts: string[] = [];
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) parts.push(`Retry-After: ${retryAfter}`);
  const reset = headers.get("x-ratelimit-reset");
  if (reset !== null) parts.push(`x-ratelimit-reset: ${reset}`);
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining !== null) parts.push(`x-ratelimit-remaining: ${remaining}`);
  return parts.join(", ");
}

export interface GithubRetryOptions {
  /** Total attempts including the first. Default {@link DEFAULT_GITHUB_MAX_ATTEMPTS}; 1 disables retry. */
  maxAttempts?: number;
  /** Injectable sleep so unit lanes never actually wait. Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable clock (epoch ms) for the `x-ratelimit-reset` delta. */
  nowImpl?: () => number;
}

/**
 * Run a GitHub request with bounded, capped, rate-limit-aware retry.
 *
 * **Returns the final `Response`; it does NOT throw** (D64.4). Exhausting the
 * budget is not this function's failure to name: each of the four consumers
 * mints its own typed error from the returned response — `GithubAppError` here,
 * `GithubRestError` in DBOS, and so on — with the throttle headers still intact
 * on it (see {@link formatGithubRateLimitHeaders}). A transport-level throw from
 * `fn` propagates unchanged; only HTTP statuses are classified here.
 *
 * `fn` must issue a *fresh* request each call — do not hand it a `Response`.
 */
export async function withGithubRetry(
  fn: () => Promise<Response>,
  opts: GithubRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(
    1,
    Math.trunc(opts.maxAttempts ?? DEFAULT_GITHUB_MAX_ATTEMPTS),
  );
  const sleepImpl = opts.sleepImpl ?? realSleep;
  const nowImpl = opts.nowImpl ?? (() => Date.now());

  let res = await fn();
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    if (res.ok || !isRetryableGithubStatus(res.status, res.headers)) return res;
    await sleepImpl(githubRetryDelayMs(res.headers, attempt, nowImpl()));
    res = await fn();
  }
  return res;
}
