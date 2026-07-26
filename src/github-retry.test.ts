import { describe, expect, it, vi } from "vitest";
import {
  isRetryableGithubStatus,
  githubRetryDelayMs,
  withGithubRetry,
  formatGithubRateLimitHeaders,
  DEFAULT_GITHUB_MAX_ATTEMPTS,
} from "./github-retry";

// Unit tests for the shared GitHub retry/backoff primitive (plan row 64, D64.2/
// D64.3/D64.4/D64.6). This is a PORT of the harness reference implementation —
// `retryDelayMs` at `supagloo/tests/support/e2e-github-api.mjs:199-210` and
// `isRetryable` at that same file's `:244-254` (tested at
// `supagloo/tests/unit/e2e-github-api.test.ts:192-267`) — that file is root TEST
// code, so the product may never import it; §11.7 wants "one implementation,
// four consumers" and db-lib is where shared primitives live.
//
// This table mirrors the root tests deliberately: if the two ever disagree, the
// harness and the product are honouring GitHub differently, which is exactly the
// drift D64.2 exists to prevent.
//
// No network, no real clock, no real sleep: every seam (`fetch`-shaped fn,
// `sleepImpl`, `nowImpl`) is injected (§10.6/§11.6 — no egress in a unit lane).

const h = (init?: Record<string, string>): Headers => new Headers(init ?? {});

/** An exact multiple of 1000 so `x-ratelimit-reset` deltas are whole seconds. */
const NOW_MS = 1_800_000_000_000;
const NOW_SECS = NOW_MS / 1000;

function makeResponse(
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ status }), { status, headers });
}

describe("isRetryableGithubStatus", () => {
  it("retries 429 (primary rate limit)", () => {
    expect(isRetryableGithubStatus(429, h())).toBe(true);
  });

  it("retries any 5xx", () => {
    expect(isRetryableGithubStatus(500, h())).toBe(true);
    expect(isRetryableGithubStatus(502, h())).toBe(true);
    expect(isRetryableGithubStatus(503, h())).toBe(true);
  });

  it("retries a 403 that carries Retry-After (SECONDARY/abuse limit)", () => {
    expect(isRetryableGithubStatus(403, h({ "retry-after": "60" }))).toBe(true);
  });

  it("retries a 403 whose x-ratelimit-remaining is exhausted", () => {
    expect(isRetryableGithubStatus(403, h({ "x-ratelimit-remaining": "0" }))).toBe(
      true,
    );
  });

  it("does NOT retry a bare 403 — that is a permission denial, not a throttle", () => {
    // §11.3: the installation deliberately holds no `administration` scope, so
    // genuine 403s are expected behaviour and must fail immediately.
    expect(isRetryableGithubStatus(403, h())).toBe(false);
    expect(
      isRetryableGithubStatus(403, h({ "x-ratelimit-remaining": "4999" })),
    ).toBe(false);
  });

  it("NEVER retries a 422 — a real conflict a retry loop would only mask", () => {
    expect(isRetryableGithubStatus(422, h())).toBe(false);
    // Not even if GitHub confusingly attaches a throttle header to it.
    expect(isRetryableGithubStatus(422, h({ "retry-after": "60" }))).toBe(false);
  });

  it("does not retry the other deterministic 4xx", () => {
    expect(isRetryableGithubStatus(400, h())).toBe(false);
    expect(isRetryableGithubStatus(401, h())).toBe(false);
    expect(isRetryableGithubStatus(404, h())).toBe(false);
    expect(isRetryableGithubStatus(409, h())).toBe(false);
  });

  it("does not retry a success", () => {
    expect(isRetryableGithubStatus(200, h())).toBe(false);
    expect(isRetryableGithubStatus(201, h())).toBe(false);
  });
});

describe("githubRetryDelayMs", () => {
  it("honours Retry-After in seconds", () => {
    expect(githubRetryDelayMs(h({ "retry-after": "5" }), 1, NOW_MS)).toBe(5_000);
  });

  it("caps a hostile Retry-After at 60s (D64.6)", () => {
    // A long in-process sleep widens the window in which a ProjectJob sits
    // `running` and a retry-from-UI collides with the §2.9 409 git-ops guard.
    expect(githubRetryDelayMs(h({ "retry-after": "3600" }), 1, NOW_MS)).toBe(
      60_000,
    );
  });

  it("ignores a non-numeric (HTTP-date) Retry-After and falls through", () => {
    expect(
      githubRetryDelayMs(
        h({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
        1,
        NOW_MS,
      ),
    ).toBe(500);
  });

  it("falls back to the x-ratelimit-reset delta when Retry-After is absent", () => {
    expect(
      githubRetryDelayMs(
        h({ "x-ratelimit-reset": String(NOW_SECS + 10) }),
        1,
        NOW_MS,
      ),
    ).toBe(10_000);
  });

  it("caps a far-future x-ratelimit-reset at 60s", () => {
    expect(
      githubRetryDelayMs(
        h({ "x-ratelimit-reset": String(NOW_SECS + 7200) }),
        1,
        NOW_MS,
      ),
    ).toBe(60_000);
  });

  it("ignores an x-ratelimit-reset already in the past", () => {
    expect(
      githubRetryDelayMs(
        h({ "x-ratelimit-reset": String(NOW_SECS - 10) }),
        2,
        NOW_MS,
      ),
    ).toBe(1_000);
  });

  it("prefers Retry-After over x-ratelimit-reset when both are present", () => {
    expect(
      githubRetryDelayMs(
        h({ "retry-after": "5", "x-ratelimit-reset": String(NOW_SECS + 30) }),
        1,
        NOW_MS,
      ),
    ).toBe(5_000);
  });

  it("falls back to exponential backoff (500 * 2^(attempt-1))", () => {
    expect(githubRetryDelayMs(h(), 1, NOW_MS)).toBe(500);
    expect(githubRetryDelayMs(h(), 2, NOW_MS)).toBe(1_000);
    expect(githubRetryDelayMs(h(), 3, NOW_MS)).toBe(2_000);
  });

  it("caps the exponential fallback at 30s (exact root-harness parity)", () => {
    expect(githubRetryDelayMs(h(), 7, NOW_MS)).toBe(30_000);
    expect(githubRetryDelayMs(h(), 20, NOW_MS)).toBe(30_000);
  });

  it("defaults `now` to the wall clock when not injected", () => {
    const reset = Math.floor(Date.now() / 1000) + 10;
    const delay = githubRetryDelayMs(h({ "x-ratelimit-reset": String(reset) }), 1);
    expect(delay).toBeGreaterThan(8_000);
    expect(delay).toBeLessThanOrEqual(10_000);
  });
});

describe("withGithubRetry", () => {
  it("returns a 2xx on the first attempt without sleeping", async () => {
    // Load-bearing: db-lib's own `github.test.ts` happy-path tests count fetches
    // exactly (1, and 2 for two mints). A retry firing on a 2xx breaks them.
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () => makeResponse(201));

    const res = await withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS });

    expect(res.status).toBe(201);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retries a 403 + Retry-After after honouring the delay, then returns the 2xx", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(makeResponse(403, { "retry-after": "1" }))
      .mockResolvedValueOnce(makeResponse(200));

    const res = await withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS });

    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepImpl.mock.calls).toEqual([[1_000]]);
  });

  it("retries a 429 using x-ratelimit-reset when Retry-After is absent", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        makeResponse(429, { "x-ratelimit-reset": String(NOW_SECS + 7) }),
      )
      .mockResolvedValueOnce(makeResponse(200));

    const res = await withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS });

    expect(res.status).toBe(200);
    expect(sleepImpl.mock.calls).toEqual([[7_000]]);
  });

  it("returns a non-retryable response immediately, unslept (422 is never retried)", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () => makeResponse(422));

    const res = await withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS });

    expect(res.status).toBe(422);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("RETURNS the final Response on exhaustion rather than throwing (D64.4)", async () => {
    // The four consumers each mint their OWN typed error from this Response, so
    // the shared driver must not pick an error type on their behalf.
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () =>
      makeResponse(403, { "retry-after": "17", "x-ratelimit-remaining": "0" }),
    );

    const res = await withGithubRetry(fn, {
      sleepImpl,
      nowImpl: () => NOW_MS,
      maxAttempts: 3,
    });

    expect(res.status).toBe(403);
    // The header survives verbatim for the caller's error message.
    expect(res.headers.get("retry-after")).toBe("17");
    expect(fn).toHaveBeenCalledTimes(3);
    // Slept between attempts only — never after the last one.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("defaults to maxAttempts = 4", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () => makeResponse(503));

    const res = await withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS });

    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleepImpl).toHaveBeenCalledTimes(3);
  });

  it("treats maxAttempts = 1 as 'no retry at all'", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () => makeResponse(429));

    const res = await withGithubRetry(fn, {
      sleepImpl,
      nowImpl: () => NOW_MS,
      maxAttempts: 1,
    });

    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("does not swallow a thrown transport error", async () => {
    const sleepImpl = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(
      withGithubRetry(fn, { sleepImpl, nowImpl: () => NOW_MS }),
    ).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("publishes its default attempt budget as a constant", () => {
    expect(DEFAULT_GITHUB_MAX_ATTEMPTS).toBe(4);
  });
});

describe("formatGithubRateLimitHeaders", () => {
  // The exhaustion message must surface GitHub's own throttle headers VERBATIM
  // (D64.2) — one formatter so all four consumers say the same thing, and so no
  // product test is ever tempted to assert on a live throttle value.
  it("renders Retry-After verbatim", () => {
    expect(formatGithubRateLimitHeaders(h({ "retry-after": "60" }))).toBe(
      "Retry-After: 60",
    );
  });

  it("renders every throttle header it finds, in a stable order", () => {
    expect(
      formatGithubRateLimitHeaders(
        h({
          "retry-after": "17",
          "x-ratelimit-reset": "1800000010",
          "x-ratelimit-remaining": "0",
        }),
      ),
    ).toBe(
      "Retry-After: 17, x-ratelimit-reset: 1800000010, x-ratelimit-remaining: 0",
    );
  });

  it("returns an empty string when GitHub sent no throttle headers", () => {
    expect(formatGithubRateLimitHeaders(h())).toBe("");
  });
});
