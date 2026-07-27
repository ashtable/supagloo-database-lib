import { describe, expect, it } from "vitest";
import * as S from "./schemas";

// ---------------------------------------------------------------------------
// Turn 16a — the publish-time "making of" snapshot (plan slice C1)
// ---------------------------------------------------------------------------
//
// `GalleryItem.makingOf` is a NULLABLE jsonb column holding a snapshot of the project
// manifest AS IT WAS AT PUBLISH TIME. The watch page renders it and NEVER reads the
// repo — a public page must not hold an installation token, and re-reading the manifest
// per view would put GitHub egress on an anonymous route.
//
// The snapshot is written by the API's publish path (slice C3) and is BEST EFFORT: a
// failed or missing manifest read leaves the column NULL and the publish still returns
// 201. Every pre-existing gallery row is therefore `makingOf: null`, and that must stay
// a valid detail DTO forever.
//
// These tests are the column's value gate. The schema is the only thing standing between
// a repo-authored manifest (user-controlled text) and a jsonb write, so the bounds below
// are enforcement, not documentation — see U-MO4/U-MO5.

const capturedAt = "2026-07-26T18:30:00.000Z";

function validSnapshot(): Record<string, unknown> {
  return {
    version: 1,
    capturedAt,
    scriptureText:
      "In the beginning God created the heaven and the earth. And the earth was without form, and void.",
    narratorVoiceLabel: "JAMES EARL JONES-STYLE",
    musicStyle: "Ambient cinematic swell",
    captionsOn: true,
    scenes: [
      { index: 1, name: "THE VOID", durationSeconds: 8 },
      { index: 2, name: "LET THERE BE LIGHT", durationSeconds: 7.5 },
      { index: 3, name: "THE FIRMAMENT", durationSeconds: 9 },
      { index: 4, name: "AND IT WAS GOOD", durationSeconds: 6 },
    ],
  };
}

/** A card-shaped `GalleryItemDto` payload — the exact contract the Turn-15 grid parses. */
function validGalleryItemDto(): Record<string, unknown> {
  return {
    id: "gi_1",
    renderJobId: "rj_1",
    projectId: "p_1",
    title: "Let There Be Light",
    description: "",
    scriptureReference: "GENESIS 1:1-4",
    scriptureBook: "GEN",
    translation: "KJV",
    durationSeconds: 30,
    visibility: "public",
    publishedAt: "2026-07-20T10:00:00.000Z",
    upvoteCount: 2412,
    thumbnailUrl: "https://example.invalid/thumb.jpg",
    rank: 1,
    viewerHasUpvoted: false,
    owner: { displayName: "Mary K", avatarInitials: "MK" },
  };
}

describe("Turn 16a — GalleryMakingOfSchema (U-MO1..U-MO5)", () => {
  it("U-MO1: a fully-populated snapshot round-trips through GalleryMakingOfSchema unchanged", () => {
    const input = validSnapshot();
    const parsed = S.GalleryMakingOfSchema.parse(input);
    expect(parsed).toEqual(input);
    // Ordering is the contract: the scene tiles render in array order, and `index` is the
    // 1-based scene number the design prints on each tile.
    expect(parsed.scenes.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(parsed.scenes[1]?.durationSeconds).toBe(7.5);
  });

  it("U-MO2: version must be the literal 1 — a {version:2} payload is REJECTED", () => {
    // A future shape change must be DETECTABLE. Without the literal, a v2 snapshot
    // written by a newer API would be half-read by an older reader: the fields it
    // recognizes parse, the ones it does not are stripped, and the page renders a
    // confident lie. Rejecting is what makes the reader degrade to `makingOf: null`.
    expect(S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), version: 2 }).success).toBe(
      false,
    );
    expect(S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), version: "1" }).success).toBe(
      false,
    );
    const noVersion = validSnapshot();
    delete noVersion.version;
    expect(S.GalleryMakingOfSchema.safeParse(noVersion).success).toBe(false);
  });

  it("U-MO3: scriptureText null is valid and captionsOn false is valid (the honest empty snapshot)", () => {
    // A manifest with no scenes, no music and no voice label still produces a VALID
    // snapshot. Every nullable field is a real "we do not have this" — never `""`, which
    // would render an empty SCRIPTURE heading over nothing.
    const empty = {
      version: 1,
      capturedAt,
      scriptureText: null,
      narratorVoiceLabel: null,
      musicStyle: null,
      captionsOn: false,
      scenes: [],
    };
    expect(S.GalleryMakingOfSchema.parse(empty)).toEqual(empty);
    // ...and the empty STRING is not an accepted stand-in for null.
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...empty, scriptureText: "" }).success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...empty, musicStyle: "" }).success,
    ).toBe(false);
  });

  it("U-MO4: scenes past 64, a zero/negative durationSeconds, a zero index, and a 20001-char scriptureText are each REJECTED", () => {
    const scene = { index: 1, name: "S", durationSeconds: 1 };
    const tooMany = {
      ...validSnapshot(),
      scenes: Array.from({ length: 65 }, (_, i) => ({ ...scene, index: i + 1 })),
    };
    expect(S.GalleryMakingOfSchema.safeParse(tooMany).success).toBe(false);
    // 64 exactly is the accepted boundary, so the bound is a bound and not an off-by-one.
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...tooMany,
        scenes: tooMany.scenes.slice(0, 64),
      }).success,
    ).toBe(true);

    for (const bad of [
      { ...scene, durationSeconds: 0 },
      { ...scene, durationSeconds: -1 },
      { ...scene, index: 0 },
      { ...scene, index: -1 },
      { ...scene, index: 1.5 },
      { ...scene, name: "" },
      { ...scene, name: "N".repeat(121) },
    ]) {
      expect(
        S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), scenes: [bad] }).success,
        `scene ${JSON.stringify(bad)} must be rejected`,
      ).toBe(false);
    }

    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        scriptureText: "x".repeat(20_001),
      }).success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        scriptureText: "x".repeat(20_000),
      }).success,
    ).toBe(true);
    for (const field of ["narratorVoiceLabel", "musicStyle"] as const) {
      expect(
        S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), [field]: "y".repeat(121) })
          .success,
        `${field} over 120 chars must be rejected`,
      ).toBe(false);
    }
  });

  it("U-MO5: a NUL byte anywhere in scriptureText / scene name is REJECTED", () => {
    // MEASURED against the Compose Postgres 17, 2026-07-26:
    //   SELECT ('{"a":"x' || E'\\u0000' || 'y"}')::jsonb
    //   -> ERROR: unsupported Unicode escape sequence
    //      DETAIL: \u0000 cannot be converted to text.
    // So a NUL reaching this column is not a cosmetic problem — it is a failed INSERT on
    // the publish path. The snapshot's own validator refuses it first.
    const nul = "\u0000";
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        scriptureText: `In the beginning${nul} God created`,
      }).success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        scenes: [{ index: 1, name: `THE${nul}VOID`, durationSeconds: 8 }],
      }).success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), narratorVoiceLabel: nul })
        .success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), musicStyle: `Ambient${nul}` })
        .success,
    ).toBe(false);

    // The rest of C0 + DEL is POLICY, matching the api's `postgres-text` rule so the two
    // boundaries cannot disagree about what a display string may contain. Tab/LF/CR are
    // the exempt three: a joined scripture paragraph may legitimately carry a newline.
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        scriptureText: "line one\nline two\tend\r",
      }).success,
    ).toBe(true);
    for (const ctrl of ["\u0007", "\u000b", "\u000c", "\u001b", "\u007f"]) {
      expect(
        S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), musicStyle: `a${ctrl}b` })
          .success,
        `control U+${ctrl.charCodeAt(0).toString(16)} must be rejected`,
      ).toBe(false);
    }
    // An UNPAIRED surrogate is refused for honesty: it is not well-formed UTF-8 and the
    // driver silently transcodes it, so we would have validated text nobody stored.
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), musicStyle: "a\ud800b" })
        .success,
    ).toBe(false);
    // ...but a WELL-FORMED pair (an emoji) is ordinary text and must pass.
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), musicStyle: "Cosmic \u{1f30c}" })
        .success,
    ).toBe(true);
  });

  it("U-MO5b: capturedAt must be an ISO-8601 instant, not any string", () => {
    expect(
      S.GalleryMakingOfSchema.safeParse({ ...validSnapshot(), capturedAt: "yesterday" })
        .success,
    ).toBe(false);
    expect(
      S.GalleryMakingOfSchema.safeParse({
        ...validSnapshot(),
        capturedAt: "2026-07-26T20:30:00+02:00",
      }).success,
    ).toBe(true);
  });
});

describe("Turn 16a — GalleryItemDetailDtoSchema (U-MO6/U-MO7)", () => {
  function validDetail(): Record<string, unknown> {
    return {
      ...validGalleryItemDto(),
      makingOf: validSnapshot(),
      owner: { displayName: "Mary K", avatarInitials: "MK", publicVideoCount: 7 },
    };
  }

  it("U-MO6: GalleryItemDetailDtoSchema accepts every field GalleryItemDtoSchema accepts", () => {
    // The widening is ADDITIVE. Anything the card contract calls valid stays valid here,
    // so `GET /v1/gallery/:id` can widen its response without a wire break (R11).
    const card = validGalleryItemDto();
    expect(S.GalleryItemDtoSchema.safeParse(card).success).toBe(true);

    const detail = S.GalleryItemDetailDtoSchema.parse(validDetail());
    for (const key of Object.keys(card)) {
      expect(detail, `detail must carry the card field ${key}`).toHaveProperty(key);
    }
    // Both nullable card fields still parse in the wider DTO.
    expect(
      S.GalleryItemDetailDtoSchema.safeParse({
        ...validDetail(),
        rank: null,
        thumbnailUrl: null,
      }).success,
    ).toBe(true);
  });

  it("U-MO7: GalleryItemDetailDto REQUIRES owner.publicVideoCount and makingOf (nullable), and a plain GalleryItemDto payload FAILS it", () => {
    // The two DTOs are genuinely different types, so the api's mapper cannot forget a
    // field and still typecheck/parse.
    expect(S.GalleryItemDetailDtoSchema.safeParse(validGalleryItemDto()).success).toBe(false);

    const noCount = validDetail();
    noCount.owner = { displayName: "Mary K", avatarInitials: "MK" };
    expect(S.GalleryItemDetailDtoSchema.safeParse(noCount).success).toBe(false);

    const noMakingOf = validDetail();
    delete noMakingOf.makingOf;
    expect(S.GalleryItemDetailDtoSchema.safeParse(noMakingOf).success).toBe(false);

    // NULL is the pre-existing-row case and must parse — every gallery item published
    // before this column existed reads back this way.
    expect(
      S.GalleryItemDetailDtoSchema.parse({ ...validDetail(), makingOf: null }).makingOf,
    ).toBeNull();

    // A negative count is a bug, not a value.
    expect(
      S.GalleryItemDetailDtoSchema.safeParse({
        ...validDetail(),
        owner: { displayName: "Mary K", avatarInitials: "MK", publicVideoCount: -1 },
      }).success,
    ).toBe(false);
    // 0 is legitimate: an owner whose only items are unlisted.
    expect(
      S.GalleryItemDetailDtoSchema.parse({
        ...validDetail(),
        owner: { displayName: "Mary K", avatarInitials: "MK", publicVideoCount: 0 },
      }).owner.publicVideoCount,
    ).toBe(0);

    // A MALFORMED snapshot must not sneak through the detail DTO: the api degrades a bad
    // stored value to null (slice C3), and this is why it cannot simply pass it along.
    expect(
      S.GalleryItemDetailDtoSchema.safeParse({
        ...validDetail(),
        makingOf: { ...validSnapshot(), version: 2 },
      }).success,
    ).toBe(false);
  });

  it("U-MO7b: GalleryItemDetailResponseSchema is the `{ item }` envelope, never a bare item", () => {
    expect(
      S.GalleryItemDetailResponseSchema.parse({ item: validDetail() }).item.owner
        .publicVideoCount,
    ).toBe(7);
    expect(S.GalleryItemDetailResponseSchema.safeParse(validDetail()).success).toBe(false);
  });
});
