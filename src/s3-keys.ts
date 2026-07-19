/**
 * Shared S3 object-key layout helpers (design-delta §4/§8).
 *
 * These are the SINGLE source of truth for how Supagloo lays out objects in S3,
 * shared so the WRITERS (the DBOS render/git-ops workflows, plan tasks 32/34/36)
 * and the READER (the API's `GET /v1/files/presign-download`, task 13) agree on
 * one format — a divergence between the two would silently break downloads. They
 * live in `database-lib` for the same reason `secrets.ts`/`github.ts` do: one
 * implementation, imported by every service.
 *
 * Canonical layouts (design-delta §8):
 *   projects/{projectId}/assets/{assetId}     — per-project uploaded assets
 *   renders/{renderJobId}/output.mp4          — a render job's final video
 *   renders/{renderJobId}/thumb.jpg           — a render job's thumbnail
 *
 * There is no `Asset` Prisma model — `assetId` is just a path segment. Ownership
 * of a key is resolved by the caller from the id it carries (project → `ownerId`,
 * render → `userId`).
 *
 * All functions are pure and read no environment.
 */

/** A recognized, well-formed S3 key, discriminated by `kind`. `parseS3Key`
 *  returns one of these, or `null` for anything it does not explicitly recognize. */
export type ParsedS3Key =
  | { kind: "project-asset"; projectId: string; assetId: string }
  | { kind: "render-output"; renderJobId: string }
  | { kind: "render-thumbnail"; renderJobId: string };

/** A single path segment must be non-empty and must not embed a `/` (which would
 *  smuggle extra segments into the layout). Builders throw rather than emit a
 *  corrupt key — a writer passing a bad id is a bug, not a silent data problem. */
function assertSegment(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    throw new Error(
      `invalid S3 key segment for ${label}: ${JSON.stringify(value)}`,
    );
  }
}

/** `projects/{projectId}/assets/{assetId}` */
export function buildAssetKey(projectId: string, assetId: string): string {
  assertSegment(projectId, "projectId");
  assertSegment(assetId, "assetId");
  return `projects/${projectId}/assets/${assetId}`;
}

/** `renders/{renderJobId}/output.mp4` */
export function buildRenderOutputKey(renderJobId: string): string {
  assertSegment(renderJobId, "renderJobId");
  return `renders/${renderJobId}/output.mp4`;
}

/** `renders/{renderJobId}/thumb.jpg` */
export function buildRenderThumbnailKey(renderJobId: string): string {
  assertSegment(renderJobId, "renderJobId");
  return `renders/${renderJobId}/thumb.jpg`;
}

/**
 * Parse an S3 key into a recognized {@link ParsedS3Key}, or `null` if it does not
 * exactly match one of the canonical layouts. Rejects empty/`.`/`..`/leading- or
 * trailing-slash segments so a malformed or traversal-shaped key can never be
 * treated as a valid, ownership-scoped key — the caller maps `null` to a 404.
 */
export function parseS3Key(key: string): ParsedS3Key | null {
  if (typeof key !== "string" || key.length === 0) return null;

  const segments = key.split("/");
  // Reject empty segments (leading/trailing/double slash) and path traversal.
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;

  if (
    segments.length === 4 &&
    segments[0] === "projects" &&
    segments[2] === "assets"
  ) {
    return {
      kind: "project-asset",
      projectId: segments[1],
      assetId: segments[3],
    };
  }

  if (segments.length === 3 && segments[0] === "renders") {
    if (segments[2] === "output.mp4") {
      return { kind: "render-output", renderJobId: segments[1] };
    }
    if (segments[2] === "thumb.jpg") {
      return { kind: "render-thumbnail", renderJobId: segments[1] };
    }
  }

  return null;
}
