import { describe, expect, it } from "vitest";
import {
  buildAssetKey,
  buildRenderOutputKey,
  buildRenderThumbnailKey,
  buildSceneNarrationAssetKey,
  parseS3Key,
} from "./s3-keys";

// Unit tests for the Task #13 shared S3 key-layout helpers (design-delta §4/§8).
// Pure, DB-free. These helpers are the SINGLE source of truth for the key format
// shared by the API (which presigns) and the future DBOS render workflows (which
// write), so generate/parse must round-trip and parse must reject anything it does
// not explicitly recognize (a malformed key must not fall through unscoped).

describe("buildAssetKey / buildRenderOutputKey / buildRenderThumbnailKey", () => {
  it("builds the canonical project-asset key", () => {
    expect(buildAssetKey("p1", "a1")).toBe("projects/p1/assets/a1");
  });

  it("builds the canonical render output + thumbnail keys", () => {
    expect(buildRenderOutputKey("j1")).toBe("renders/j1/output.mp4");
    expect(buildRenderThumbnailKey("j1")).toBe("renders/j1/thumb.jpg");
  });

  it("throws on an empty or slash-containing segment (never emits a corrupt key)", () => {
    expect(() => buildAssetKey("", "a1")).toThrow();
    expect(() => buildAssetKey("p1", "")).toThrow();
    expect(() => buildAssetKey("p/1", "a1")).toThrow();
    expect(() => buildAssetKey("p1", "a/1")).toThrow();
    expect(() => buildRenderOutputKey("")).toThrow();
    expect(() => buildRenderOutputKey("j/1")).toThrow();
    expect(() => buildRenderThumbnailKey("")).toThrow();
  });
});

describe("parseS3Key — round-trips every builder", () => {
  it("parses a project-asset key", () => {
    expect(parseS3Key(buildAssetKey("proj-123", "asset-abc"))).toEqual({
      kind: "project-asset",
      projectId: "proj-123",
      assetId: "asset-abc",
    });
  });

  it("parses a render output key", () => {
    expect(parseS3Key(buildRenderOutputKey("rj-9"))).toEqual({
      kind: "render-output",
      renderJobId: "rj-9",
    });
  });

  it("parses a render thumbnail key", () => {
    expect(parseS3Key(buildRenderThumbnailKey("rj-9"))).toEqual({
      kind: "render-thumbnail",
      renderJobId: "rj-9",
    });
  });
});

describe("parseS3Key — rejects anything unrecognized (returns null)", () => {
  const rejected = [
    "", // empty
    "foo", // single segment
    "projects/p1", // too few
    "projects/p1/assets", // too few
    "projects/p1/assets/a1/extra", // too many
    "projects//assets/a1", // empty segment
    "projects/p1/tags/a1", // wrong literal
    "renders/j1", // too few
    "renders/j1/evil.exe", // unknown file
    "renders/j1/output.mp4/x", // too many
    "/projects/p1/assets/a1", // leading slash → empty first segment
    "projects/p1/assets/a1/", // trailing slash → empty last segment
    "projects/../assets/a1", // traversal
    "renders/../thumb.jpg", // traversal
    "projects/p1/assets/.", // dot segment
  ];

  for (const key of rejected) {
    it(`returns null for ${JSON.stringify(key)}`, () => {
      expect(parseS3Key(key)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Per-scene narration assets (render-bug work): N assets for ONE AiGeneration row.
// ---------------------------------------------------------------------------

describe("buildSceneNarrationAssetKey", () => {
  it("U-K1: stays a FOUR-segment project-asset key so parseS3Key still recognizes it", () => {
    // The trap this test exists to close: `parseS3Key` matches project assets on
    // `segments.length === 4` EXACTLY, and the API's presign-download route maps a
    // null parse to a 404. A nested `projects/p/assets/gen/scene-s1` key would be five
    // segments, so every per-scene narration preview in the studio would 404 — with the
    // failure surfacing as "not found", indistinguishable from "not yours".
    const key = buildSceneNarrationAssetKey("proj-1", "gen-9", "s2");
    expect(key.split("/")).toHaveLength(4);
    expect(parseS3Key(key)).toEqual({
      kind: "project-asset",
      projectId: "proj-1",
      assetId: "gen-9-scene-s2",
    });
  });

  it("U-K2: is distinct per scene and stable for the same scene", () => {
    const a = buildSceneNarrationAssetKey("p", "g", "s1");
    const b = buildSceneNarrationAssetKey("p", "g", "s2");
    expect(a).not.toBe(b);
    expect(buildSceneNarrationAssetKey("p", "g", "s1")).toBe(a);
  });

  it("U-K3: throws rather than emit a corrupt key when a sceneId smuggles a slash", () => {
    expect(() => buildSceneNarrationAssetKey("p", "g", "s1/../../evil")).toThrow();
    expect(() => buildSceneNarrationAssetKey("p", "g", "")).toThrow();
  });
});
