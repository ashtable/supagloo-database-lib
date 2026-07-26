import { describe, expect, it } from "vitest";
// Namespace import of the barrel so the explicit re-export from src/index.ts is
// proven (scripture-book is NOT covered by `export * from "./schemas"`).
import * as DbLib from "./index";
import {
  MATCH_PHRASES,
  SCRIPTURE_BOOKS,
  deriveScriptureBook,
  isScriptureBookCode,
  phraseVariants,
} from "./scripture-book";

// Unit tests for the Task #39 shared scripture-book deriver (plan D6). DB-free,
// network-free, pure. The publish endpoint (`POST /v1/renders/:id/gallery`) turns a
// `null` derivation into a 422 `scripture_book_underivable`, so every case below is
// load-bearing for a real HTTP status. References in the wild come in TWO shapes —
// human (`"PSALM 23:2"`, `"GENESIS 1:1-4"`) and strict USFM (`"GEN.1.1"`, the shape the
// DBOS YouVersion client requires) — so the deriver must accept both.
//
// THE ASYMMETRY THAT SHAPES EVERY TEST HERE: a `null` derivation is a loud,
// client-fixable 422; a WRONG derivation is a silent, permanent mis-file of a public
// gallery item into the wrong facet. So the false-positive tests (the "prose must not
// resolve" block) are as load-bearing as the happy path, and several of them exist
// because a mutation audit caught the module returning a real book code for real
// English prose.

/** Every phrase the table claims for a book: its code, its name, its aliases. */
function phrasesOf(book: (typeof SCRIPTURE_BOOKS)[number]): string[] {
  return [book.code, book.name, ...book.aliases];
}

// ---------------------------------------------------------------------------
// U-SB1 — the table itself
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — SCRIPTURE_BOOKS table (U-SB1)", () => {
  it("lists exactly the 66 books of the protestant canon", () => {
    expect(SCRIPTURE_BOOKS).toHaveLength(66);
  });

  it("every code is unique, uppercase and 2-3 characters (USFM)", () => {
    const codes = SCRIPTURE_BOOKS.map((b) => b.code);
    expect(new Set(codes).size, "codes are unique").toBe(66);
    for (const code of codes) {
      expect(code, `${code} is uppercase`).toBe(code.toUpperCase());
      expect(code.length, `${code} length >= 2`).toBeGreaterThanOrEqual(2);
      expect(code.length, `${code} length <= 3`).toBeLessThanOrEqual(3);
    }
  });

  it("every name is unique and non-empty", () => {
    const names = SCRIPTURE_BOOKS.map((b) => b.name);
    expect(new Set(names).size, "names are unique").toBe(66);
    for (const name of names) {
      expect(name.length, `${name} non-empty`).toBeGreaterThan(0);
      expect(name, `${name} is uppercase-normalized`).toBe(name.toUpperCase());
    }
  });

  it("keeps canonical order — Genesis first, Malachi at 39, Revelation last", () => {
    expect(SCRIPTURE_BOOKS[0]?.code).toBe("GEN");
    expect(SCRIPTURE_BOOKS[38]?.code).toBe("MAL");
    expect(SCRIPTURE_BOOKS[39]?.code).toBe("MAT");
    expect(SCRIPTURE_BOOKS[65]?.code).toBe("REV");
  });

  it("no phrase (code / name / alias) is claimed by two DIFFERENT books", () => {
    const owner = new Map<string, string>();
    for (const book of SCRIPTURE_BOOKS) {
      for (const phrase of phrasesOf(book)) {
        const key = phrase.toUpperCase();
        const prior = owner.get(key);
        expect(
          prior === undefined || prior === book.code,
          `phrase ${JSON.stringify(key)} is claimed by both ${prior} and ${book.code}`,
        ).toBe(true);
        owner.set(key, book.code);
      }
    }
  });

  // The guard above only sees the RAW table. Matching happens over the
  // `phraseVariants()`-EXPANDED space ("1CO" also matches as "1 CO", "1 CORINTHIANS"
  // also as "1CORINTHIANS"), and `MATCH_PHRASES` resolves a duplicate variant
  // first-claimant-wins — silently. A collision that exists only in the expanded space
  // would therefore never be reported by the raw guard, so it gets its own.
  it("no EXPANDED variant is claimed by two different books, and none is swallowed", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const book of SCRIPTURE_BOOKS) {
      for (const source of phrasesOf(book)) {
        for (const variant of phraseVariants(source)) {
          const prior = owner.get(variant);
          if (prior !== undefined && prior !== book.code) {
            collisions.push(
              `${JSON.stringify(variant)} claimed by both ${prior} and ${book.code}`,
            );
          } else {
            owner.set(variant, book.code);
          }
        }
      }
    }
    expect(collisions).toEqual([]);
    // Nothing was dropped on the way into the matcher: every distinct variant is a
    // live match phrase. If MATCH_PHRASES were ever shorter than the variant space, a
    // spelling the table claims would be unreachable.
    expect(MATCH_PHRASES).toHaveLength(owner.size);
  });

  // The matcher tries phrases LONGEST-FIRST at each position, which is how "longest
  // match wins" holds regardless of table order. This is asserted STRUCTURALLY on
  // purpose: with the reference-shape rule in place, every mid-word cut is independently
  // rejected (a letter can never open a valid tail), so today's table has no input that
  // isolates the sort behaviourally. The sort is kept anyway — it is what stops the
  // property from depending on the order aliases happen to be written in — and this
  // assertion is what makes deleting it fail.
  it("orders MATCH_PHRASES longest-first (the structural form of longest-match-wins)", () => {
    const lengths = MATCH_PHRASES.map((p) => p.phrase.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(MATCH_PHRASES.length).toBeGreaterThan(SCRIPTURE_BOOKS.length);
  });
});

// ---------------------------------------------------------------------------
// U-SB1b — EVERY book resolves from a LITERAL, hand-written human reference
// ---------------------------------------------------------------------------

// Written out by hand, one per canonical book, NOT derived from SCRIPTURE_BOOKS.
// This is the only test in the file that can catch a typo in the table itself: a
// generated assertion (`deriveScriptureBook(book.name)` === book.code) is satisfied by
// a misspelled name, because it looks the misspelling up in the same misspelled table.
// Mutating `HABAKKUK` to `HABAKUK` leaves every generated assertion green while
// "Habakkuk 2:4" starts deriving null — a permanent 422 on a legitimate publish.
const LITERAL_REFERENCES: ReadonlyArray<readonly [string, string]> = [
  ["Genesis 1:1", "GEN"],
  ["Exodus 20:3", "EXO"],
  ["Leviticus 19:18", "LEV"],
  ["Numbers 6:24", "NUM"],
  ["Deuteronomy 6:5", "DEU"],
  ["Joshua 1:9", "JOS"],
  ["Judges 6:12", "JDG"],
  ["Ruth 1:16", "RUT"],
  ["1 Samuel 16:7", "1SA"],
  ["2 Samuel 7:12", "2SA"],
  ["1 Kings 19:12", "1KI"],
  ["2 Kings 6:17", "2KI"],
  ["1 Chronicles 16:34", "1CH"],
  ["2 Chronicles 7:14", "2CH"],
  ["Ezra 3:11", "EZR"],
  ["Nehemiah 8:10", "NEH"],
  ["Esther 4:14", "EST"],
  ["Job 19:25", "JOB"],
  ["Psalm 23:1", "PSA"],
  ["Proverbs 3:5", "PRO"],
  ["Ecclesiastes 3:1", "ECC"],
  ["Song of Solomon 2:1", "SNG"],
  ["Isaiah 53:5", "ISA"],
  ["Jeremiah 29:11", "JER"],
  ["Lamentations 3:22", "LAM"],
  ["Ezekiel 36:26", "EZK"],
  ["Daniel 3:17", "DAN"],
  ["Hosea 6:6", "HOS"],
  ["Joel 2:28", "JOL"],
  ["Amos 5:24", "AMO"],
  ["Obadiah 1:15", "OBA"],
  ["Jonah 2:9", "JON"],
  ["Micah 6:8", "MIC"],
  ["Nahum 1:7", "NAM"],
  ["Habakkuk 2:4", "HAB"],
  ["Zephaniah 3:17", "ZEP"],
  ["Haggai 2:9", "HAG"],
  ["Zechariah 4:6", "ZEC"],
  ["Malachi 3:10", "MAL"],
  ["Matthew 5:9", "MAT"],
  ["Mark 12:31", "MRK"],
  ["Luke 6:31", "LUK"],
  ["John 3:16", "JHN"],
  ["Acts 2:38", "ACT"],
  ["Romans 8:28", "ROM"],
  ["1 Corinthians 13:4", "1CO"],
  ["2 Corinthians 5:17", "2CO"],
  ["Galatians 5:22", "GAL"],
  ["Ephesians 2:8", "EPH"],
  ["Philippians 4:13", "PHP"],
  ["Colossians 3:23", "COL"],
  ["1 Thessalonians 5:16", "1TH"],
  ["2 Thessalonians 3:3", "2TH"],
  ["1 Timothy 6:12", "1TI"],
  ["2 Timothy 1:7", "2TI"],
  ["Titus 2:11", "TIT"],
  ["Philemon 1:6", "PHM"],
  ["Hebrews 11:1", "HEB"],
  ["James 1:5", "JAS"],
  ["1 Peter 5:7", "1PE"],
  ["2 Peter 3:9", "2PE"],
  ["1 John 4:8", "1JN"],
  ["2 John 1:6", "2JN"],
  ["3 John 1:4", "3JN"],
  ["Jude 1:24", "JUD"],
  ["Revelation 21:4", "REV"],
];

describe("Task #39 scripture-book — every book from a LITERAL reference (U-SB1b)", () => {
  it.each(LITERAL_REFERENCES)(
    "derives %s to %s",
    (reference: string, code: string) => {
      expect(deriveScriptureBook(reference)).toBe(code);
    },
  );

  it("covers all 66 canonical codes exactly once (so a new book cannot skip the list)", () => {
    const literalCodes = LITERAL_REFERENCES.map(([, code]) => code);
    expect(literalCodes).toHaveLength(66);
    expect(new Set(literalCodes).size).toBe(66);
    expect([...literalCodes].sort()).toEqual(
      SCRIPTURE_BOOKS.map((b) => b.code).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// U-SB2 — USFM codes derive to themselves
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — USFM codes (U-SB2)", () => {
  it("derives the four named codes to themselves", () => {
    expect(deriveScriptureBook("GEN")).toBe("GEN");
    expect(deriveScriptureBook("JHN")).toBe("JHN");
    expect(deriveScriptureBook("1CO")).toBe("1CO");
    expect(deriveScriptureBook("PSA")).toBe("PSA");
  });

  it("derives EVERY table code to itself, bare and with a USFM chapter/verse", () => {
    for (const book of SCRIPTURE_BOOKS) {
      expect(deriveScriptureBook(book.code), `${book.code} bare`).toBe(book.code);
      expect(
        deriveScriptureBook(`${book.code}.1.1`),
        `${book.code}.1.1`,
      ).toBe(book.code);
    }
  });

  // ROUND-TRIP, not a correctness proof: it derives each phrase from the same table the
  // matcher reads, so a misspelled name round-trips happily. Its real job is to prove
  // every phrase the table claims is REACHABLE (no phrase shadowed by another book's,
  // no phrase unreachable through the boundary/shape guards). Correctness of the
  // spellings themselves is LITERAL_REFERENCES' job.
  it("every name and alias is REACHABLE and resolves to its own book (no shadowing)", () => {
    for (const book of SCRIPTURE_BOOKS) {
      for (const phrase of phrasesOf(book)) {
        expect(deriveScriptureBook(phrase), `${phrase} bare`).toBe(book.code);
        expect(
          deriveScriptureBook(`${phrase} 1:1`),
          `${phrase} 1:1`,
        ).toBe(book.code);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// U-SB3 — human names (the shape the studio actually holds)
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — human references (U-SB3)", () => {
  it("derives the wild-caught references from the nextjs storyboard fixtures", () => {
    expect(deriveScriptureBook("Genesis 1:1")).toBe("GEN");
    expect(deriveScriptureBook("GENESIS 1:1–4")).toBe("GEN"); // en dash
    expect(deriveScriptureBook("Psalm 23")).toBe("PSA");
    expect(deriveScriptureBook("PSALM 23:2")).toBe("PSA");
    expect(deriveScriptureBook("1 Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("Song of Solomon 2:1")).toBe("SNG");
    expect(deriveScriptureBook("JOHN 1:23")).toBe("JHN");
    expect(deriveScriptureBook("GEN 1:1")).toBe("GEN");
  });

  it("normalizes em dash, figure dash and curly apostrophes without losing the book", () => {
    expect(deriveScriptureBook("GENESIS 1:1—4")).toBe("GEN"); // em dash
    expect(deriveScriptureBook("GENESIS 1:1‑4")).toBe("GEN"); // U+2011
    // The curly-apostrophe fold is LOAD-BEARING here: a possessive is accepted as part
    // of the book phrase ("Song of Solomon's 2:1" is a reference to Song of Solomon),
    // and that acceptance matches the ASCII `'S` only. Without the fold the tail reads
    // `’S 2:1`, which is not reference-shaped, and the derivation is null.
    expect(deriveScriptureBook("Song of Solomon’s 2:1")).toBe("SNG");
    expect(deriveScriptureBook("Song of Solomon's 2:1")).toBe("SNG");
    expect(deriveScriptureBook("John’s 3:16")).toBe("JHN");
  });
});

// ---------------------------------------------------------------------------
// U-SB4 — longest match at the earliest position
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — longest-match is load-bearing (U-SB4)", () => {
  it("1 John is 1JN, NOT John (JHN)", () => {
    expect(deriveScriptureBook("1 John 4:8")).toBe("1JN");
    expect(deriveScriptureBook("2 John 1")).toBe("2JN");
    expect(deriveScriptureBook("3 John 2")).toBe("3JN");
  });

  // HONESTY NOTE, because the obvious reading of this test is wrong: `SONG` is itself an
  // alias of SNG (both spellings of the book name resolve to the same code), so this
  // assertion CANNOT distinguish "matched the 13-char phrase" from "matched the 4-char
  // prefix". It is a RECALL assertion — both spellings, plus the Canticles alias, must
  // resolve — and it is here because D6 names "Song of Songs" explicitly. The
  // longest-match MECHANISM is pinned structurally by the MATCH_PHRASES sort test in
  // U-SB1; there is no input in the current table that pins it behaviourally, because
  // the reference-shape rule independently rejects every short-prefix match.
  it("resolves all three spellings of Song of Solomon (recall, not a longest-match proof)", () => {
    expect(deriveScriptureBook("Song of Songs 1:1")).toBe("SNG");
    expect(deriveScriptureBook("Song of Solomon 2:1")).toBe("SNG");
    expect(deriveScriptureBook("Canticles 1:1")).toBe("SNG");
    expect(deriveScriptureBook("Song 1:1")).toBe("SNG");
  });

  // These four pin the documented semantics AND real alias coverage: drop JDG's `JUDG`
  // alias, or PHM's name, and the corresponding line goes red rather than quietly
  // answering the neighbouring book.
  it("Judges is JDG while Jude is JUD (the JUD prefix must not win inside JUDGES)", () => {
    expect(deriveScriptureBook("Judges 6:12")).toBe("JDG");
    expect(deriveScriptureBook("Judg 6:12")).toBe("JDG");
    expect(deriveScriptureBook("Jude 1:3")).toBe("JUD");
    expect(deriveScriptureBook("JUD")).toBe("JUD");
  });

  it("longer names beat their own prefixes (Revelations, Psalms, Philemon vs Philippians)", () => {
    expect(deriveScriptureBook("Revelations 21:4")).toBe("REV");
    expect(deriveScriptureBook("Psalms 23")).toBe("PSA");
    expect(deriveScriptureBook("Philemon 1:6")).toBe("PHM");
    expect(deriveScriptureBook("Philippians 4:13")).toBe("PHP");
  });
});

// ---------------------------------------------------------------------------
// U-SB5 — numeric-prefix folding
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — numeric prefix folding (U-SB5)", () => {
  it("folds 1 / I / FIRST and the space-less USFM form onto 1CO", () => {
    for (const ref of [
      "1 Corinthians 13",
      "I Corinthians 13",
      "First Corinthians 13",
      "1 Cor 13",
      "1CO.13.4",
      "1Corinthians 13",
      "1 CO 13:4",
    ]) {
      expect(deriveScriptureBook(ref), ref).toBe("1CO");
    }
  });

  it("folds II / SECOND and III / THIRD too", () => {
    expect(deriveScriptureBook("II Corinthians 5:17")).toBe("2CO");
    expect(deriveScriptureBook("Second Corinthians 5:17")).toBe("2CO");
    expect(deriveScriptureBook("III John 4")).toBe("3JN");
    expect(deriveScriptureBook("Third John 4")).toBe("3JN");
    expect(deriveScriptureBook("II Samuel 7:12")).toBe("2SA");
    expect(deriveScriptureBook("First Kings 19:12")).toBe("1KI");
  });

  // The ORDINAL-SUFFIX spelling. Before this was folded, "1st John 4:8" derived JHN —
  // a WRONG non-null code written to a non-null column that drives a public
  // single-select facet, i.e. exactly the silent mis-file the module trades recall to
  // avoid. It mis-filed rather than merely degrading because JOHN is the only bare book
  // name left standing once the unrecognized "1ST" token is skipped.
  it("folds the ordinal-suffix spelling (1st / 2nd / 3rd), which used to mis-file as JOHN", () => {
    expect(deriveScriptureBook("1st John 4:8")).toBe("1JN");
    expect(deriveScriptureBook("2nd John 1")).toBe("2JN");
    expect(deriveScriptureBook("3rd John 4")).toBe("3JN");
    expect(deriveScriptureBook("1ST JOHN 4:8")).toBe("1JN");
    expect(deriveScriptureBook("1st Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("2nd Timothy 1:7")).toBe("2TI");
    expect(deriveScriptureBook("1st Peter 5:7")).toBe("1PE");
    expect(deriveScriptureBook("2nd Samuel 7:12")).toBe("2SA");
    expect(deriveScriptureBook("3rd John 1:4")).toBe("3JN");
  });

  it("folds a roman numeral written with a trailing period (I. / II. / III.)", () => {
    expect(deriveScriptureBook("I. Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("II. Kings 6:17")).toBe("2KI");
    expect(deriveScriptureBook("III. John 4")).toBe("3JN");
    expect(deriveScriptureBook("1st. John 4:8")).toBe("1JN");
  });

  it("does NOT fold a numeral that is merely the start of a word (Isaiah, Iron)", () => {
    expect(deriveScriptureBook("Isaiah 53:5")).toBe("ISA");
    expect(deriveScriptureBook("Ironsmith 1:1")).toBeNull();
  });

  it("does NOT fold an ordinal that is part of a larger number (21st)", () => {
    // "21st Psalm" is not "1 Psalm"; the fold is anchored at a token start.
    expect(deriveScriptureBook("21st Psalm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// U-SB6 — case / whitespace insensitivity
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — case + whitespace (U-SB6)", () => {
  it("is case-insensitive and collapses runs of whitespace", () => {
    expect(deriveScriptureBook("  genesis   1:1 ")).toBe("GEN");
    expect(deriveScriptureBook("\tgEnEsIs\n1:1")).toBe("GEN");
    expect(deriveScriptureBook("1    corinthians    13")).toBe("1CO");
    expect(deriveScriptureBook("song of songs 1:1")).toBe("SNG");
  });

  // An article-prefixed reference WITH a chapter never needed the article handled at
  // all — the book still opens a chapter-shaped tail at index 4. These two are here
  // because D6 names them, and because "Theodore"/"Theology 101" must never be mistaken
  // for an article plus a book.
  it("resolves an article-prefixed reference and never mistakes THE inside a word", () => {
    expect(deriveScriptureBook("The Revelation 21:4")).toBe("REV");
    expect(deriveScriptureBook("The Acts 2:1")).toBe("ACT");
    // "Theodore" must NOT become "odore" — and must not resolve at all.
    expect(deriveScriptureBook("Theodore")).toBeNull();
    expect(deriveScriptureBook("Theology 101")).toBeNull();
  });

  // The article forms are a CURATED ALIAS SET ("THE ACTS", "THE REVELATION", "THE SONG
  // OF SOLOMON", "THE SONG OF SONGS", "THE PSALMS"), not a general `THE `-strip: five
  // titles across four books, the only ones whose conventional English form carries the
  // definite article. The set is closed — see the W2 block below for what it excludes.
  it("resolves the CURATED article-prefixed titles", () => {
    expect(deriveScriptureBook("The Revelation")).toBe("REV");
    expect(deriveScriptureBook("the acts")).toBe("ACT");
    expect(deriveScriptureBook("The Song of Solomon")).toBe("SNG");
    expect(deriveScriptureBook("The Song of Songs")).toBe("SNG");
    expect(deriveScriptureBook("The Psalms")).toBe("PSA");
    expect(deriveScriptureBook("The Psalms 23")).toBe("PSA");
    expect(deriveScriptureBook("The Song of Solomon's 2:1")).toBe("SNG");
    // and it still cannot invent a book out of prose that merely starts with "THE ".
    expect(deriveScriptureBook("The quick brown fox")).toBeNull();
  });

  // W2 (residual audit of 419bba5). The old general `THE `-strip re-scanned the string
  // with the article removed, which created a SECOND position 0 — and the BARE form of
  // the shape rule only needs position 0. So every one-word book and alias got a free
  // article-prefixed prose form alongside the intended titles. Each of these strings is
  // ordinary English, and each derived a real book code before the strip was replaced by
  // the curated alias set above.
  it.each([
    ["The Job", "JOB"],
    ["The Song", "SNG"],
    ["The Psalm", "PSA"],
    ["The Numbers", "NUM"],
    ["The Judges", "JDG"],
    ["The Genesis", "GEN"],
    ["The John", "JHN"],
    // Not a strip case — this one guards the NEW mechanism. "THE ACTS" is now a match
    // phrase, so it matches at position 0 here; the shape rule must still reject it
    // because the string continues into prose.
    ["The Acts of the Apostles were many", "null (guards the alias, not the strip)"],
  ])(
    "returns null for %s, which the THE-strip used to derive as %s (W2)",
    (reference: string) => {
      expect(deriveScriptureBook(reference)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// U-SB7 — multi-book references collapse to the FIRST recognized book
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — multi-book -> first book (U-SB7)", () => {
  it("takes the first recognized book of a cross-book range or list", () => {
    expect(deriveScriptureBook("Genesis 1:1 – Exodus 2:2")).toBe("GEN");
    expect(deriveScriptureBook("PSALM 23; JOHN 3:16")).toBe("PSA");
    expect(deriveScriptureBook("GEN.1.1-EXO.2.2")).toBe("GEN");
    expect(deriveScriptureBook("Romans 8:28 and Ephesians 2:8")).toBe("ROM");
  });

  it("earliest position wins even when a LATER book name is longer", () => {
    // "JOB" (3) appears before "PHILIPPIANS" (11): position beats length.
    expect(deriveScriptureBook("Job 1:21, Philippians 4:13")).toBe("JOB");
  });

  // A joiner (a separator character, or the words AND/TO) continues a reference only when
  // it leads to ANOTHER REFERENCE SEGMENT: a book that carries its own chapter number, or
  // a book joined onward to one. "A second book is named" is not enough (that is what
  // keeps "Amos and Andy" from deriving AMO, and what the W1 block in U-SB7b is about).
  //
  // *** DELIBERATE CONTRACT CHANGE (final pre-release pass) ***
  // A CHAPTER-FREE book range used to resolve to its first book: "Romans…Ephesians" was
  // ROM and "Genesis - Exodus" was GEN. Both are now null -> a loud 422. That is the
  // price of closing W1: the same form (c) that accepted them also accepted every
  // "<book><joiner><book>" string ("Ho, Ho, Ho" -> HOS), which is a SILENT, permanent
  // mis-file of a public facet. A chapter-free book range is an unusual way to fill
  // `scriptureReference`, the 422 names the reference, and the client can write
  // "Romans 1 - Ephesians 6"; a wrong facet cannot be recovered at all. D6 requires
  // multi-book -> FIRST book, which still holds for every reference that reaches a
  // chapter number.
  it("rejects a join that never reaches a chapter, and a join with no second book", () => {
    expect(deriveScriptureBook("Romans…Ephesians")).toBeNull();
    expect(deriveScriptureBook("Genesis - Exodus")).toBeNull();
    // The same shape as prose rather than as a range, and the module cannot tell them
    // apart: two given names, or two gospels. Both now cost a 422 instead of a guess.
    expect(deriveScriptureBook("Mark and John")).toBeNull();
    expect(deriveScriptureBook("Luke and John")).toBeNull();
    // ...while form (c) itself stays alive and load-bearing: once the chain reaches a
    // chapter, a chapter-less FIRST segment still wins. Deleting form (c) instead of
    // tightening it would answer EXO / LEV here — a wrong facet, strictly worse than the
    // 422 above. The third case is why the chain is WALKED rather than probed one step:
    // a one-step rule answers EXO for it.
    expect(deriveScriptureBook("Genesis - Exodus 1:1")).toBe("GEN");
    expect(deriveScriptureBook("Romans…Ephesians 2:8")).toBe("ROM");
    expect(deriveScriptureBook("Genesis - Exodus - Leviticus 1:1")).toBe("GEN");
    expect(deriveScriptureBook("Genesis, Exodus, Leviticus 1:1")).toBe("GEN");
    expect(deriveScriptureBook("Genesis 1 and Exodus 2")).toBe("GEN");
    // After a chapter number a joiner may also introduce another NUMBER, because
    // "Genesis 1 to 3" is a real chapter range.
    expect(deriveScriptureBook("Genesis 1 to 3")).toBe("GEN");
    expect(deriveScriptureBook("Genesis 1 to nowhere")).toBeNull();
    expect(deriveScriptureBook("Amos and Andy")).toBeNull();
    expect(deriveScriptureBook("Ho, hum")).toBeNull();
    // ...but a bare NUMBER is not enough to make a joiner a reference join, or every
    // "<alias>, <number>" fragment of prose would resolve.
    expect(deriveScriptureBook("Ho, 3 blind mice")).toBeNull();
  });

  // *** FIXED IN THIS PASS, found by the regression sweep rather than by the audit ***
  // Two references written with NO separator between them. The chapter number of the
  // first was not "properly terminated" (a space then a word), so the first book was
  // REJECTED and the scan walked on to answer the SECOND book — a silent wrong facet, and
  // a direct violation of D6's multi-book -> FIRST book. A following BOOK now terminates a
  // chapter number, so the first book wins. The fix is deliberately narrow: only a
  // recognized BOOK opens this door, never any word, which is what keeps the W4 pins
  // ("Psalm 23 KJV") and "PS I love you" null.
  it("takes the FIRST book when two references are written with no separator", () => {
    expect(deriveScriptureBook("Psalm 23 John 3:16")).toBe("PSA"); // was JHN
    expect(deriveScriptureBook("Genesis 1 Exodus 2")).toBe("GEN"); // was EXO
    expect(deriveScriptureBook("Mark 10 Luke 18:16")).toBe("MRK");
    // The guards that must survive the widening: a WORD is still not a terminator.
    expect(deriveScriptureBook("Psalm 23 KJV")).toBeNull();
    expect(deriveScriptureBook("PS I love you")).toBeNull();
    expect(deriveScriptureBook("Job interview at 9")).toBeNull();
  });

  it("a leading non-book word does not hand the reference to a LATER book", () => {
    // The plan's rule is FIRST RECOGNIZED BOOK. An anchoring rule that only allowed a
    // match at position 0 (or after a separator) would make GENESIS unreachable here
    // and answer EXO — a wrong facet, which is worse than a 422.
    expect(deriveScriptureBook("Read Genesis 1:1, Exodus 2:2")).toBe("GEN");
    expect(deriveScriptureBook("See John 3:16")).toBe("JHN");
  });
});

// ---------------------------------------------------------------------------
// U-SB7b — the reference-SHAPE rule: prose must never resolve to a book
// ---------------------------------------------------------------------------

// Each of these strings was returning a real book code before the shape rule landed.
// Every one of them is a silent, permanent mis-file of a public gallery item, so each
// gets its own explicit assertion rather than riding on one lucky sample string.
describe("Task #39 scripture-book — prose is not a reference (U-SB7b)", () => {
  it.each([
    ["this is a song about hope", "SONG is an alias of SNG"],
    ["a psalm of thanksgiving", "PSALM is an alias of PSA"],
    ["Ho Ho Ho", "HO is an alias of HOS and the last one ended the string"],
    ["PS I love you", "PS is an alias of PSA and the folded `I` looked like a chapter"],
    ["Mt Sinai", "MT is an alias of MAT"],
    ["A New Song", "SONG is an alias of SNG and ended the string"],
    ["Job interview at 9", "JOB is a book name and a common noun"],
  ])("returns null for %s (%s)", (reference: string) => {
    expect(deriveScriptureBook(reference)).toBeNull();
  });

  it("still returns null for the neighbouring prose the same aliases invite", () => {
    for (const ref of [
      "Ho ho, merry Christmas",
      "PS thanks again",
      "Mount Sinai at dawn",
      "a job well done",
      "sing a new song to the Lord",
      "psalms of my childhood",
      "The Acts of the Apostles were many",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).toBeNull();
    }
  });

  // W1 (residual audit of 419bba5). "Ho Ho Ho" (spaces) was pinned above, but the
  // COMMA-spelled Santa laugh — the more natural spelling — still derived HOS, because
  // form (c) of the shape rule only asked "is another book named after this joiner", and
  // a REPEATED one-word alias answers yes. Every string here is prose that derived a
  // real book code on the built module before this pass; each is a permanent mis-file of
  // a public gallery facet, so each gets its own assertion. What closes all ten is that
  // a joiner must now reach a CHAPTER NUMBER, and none of these has one anywhere.
  it.each([
    ["Ho, Ho, Ho", "HOS"],
    ["Ho, ho, ho!", "HOS"],
    ["Ho-Ho", "HOS"],
    ["Ho & Ho", "HOS"],
    ["Ho/Ho", "HOS"],
    ["Ho and Ho", "HOS"],
    ["Song, Song", "SNG"],
    ["song and song", "SNG"],
    ["Job, Job", "JOB"],
    ["PS, PS", "PSA"],
  ])("returns null for %s, which used to derive %s (W1)", (reference: string) => {
    expect(deriveScriptureBook(reference)).toBeNull();
  });

  // The same class WITH a number in the string. These are why the rule is "the joined
  // chain reaches a chapter" and not the cheaper "the string contains a digit somewhere":
  // the digit here belongs to neither book, so a digit-anywhere gate lets all three
  // through.
  it("returns null for a repeated-book join even when the string carries a number (W1)", () => {
    for (const ref of [
      "Song and song, take 2",
      "Ho, ho 3 times",
      "Job, job for 2 years",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).toBeNull();
    }
  });

  // The OTHER rule that was tried and rejected — "the joined book must be a DIFFERENT
  // book" — is pinned here by its victim. With "1 JOHN" refused at position 0 for joining
  // back onto itself, the scan fell through to the bare JOHN at index 2, whose join onto
  // 1JN then looked like a different book, and answered JHN: a CROSS-BOOK wrong facet,
  // the "1st John" mis-file family reopened. Under the shipped rule the chain never
  // reaches a chapter, so nothing resolves and nothing mis-files.
  it("never lets an ordinal book fall through to its bare name (the 1 John trap)", () => {
    // The invariant, stated first because it is the whole point: NOTHING in this family
    // may answer JHN. Whether a given spelling resolves to the ordinal book or to null is
    // secondary; answering the wrong BOOK is the unrecoverable outcome.
    for (const ref of [
      "1 John and 1 John",
      "1 John, 1 John",
      "2 John and 2 John",
      "3 John and 3 John",
      "1 Jn and 1 Jn",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).not.toBe("JHN");
    }
    // The exact values, so a future change to either rule is visible rather than silent.
    expect(deriveScriptureBook("1 John and 1 John")).toBeNull();
    expect(deriveScriptureBook("2 John and 2 John")).toBeNull();
    // The COMMA spelling resolves — and resolves to the ORDINAL book. "1 JOHN, 1" reads
    // as chapter 1 of 1 John followed by another book, which is form (b), not form (c).
    expect(deriveScriptureBook("1 John, 1 John")).toBe("1JN");
    // ...and with a real chapter anywhere in the chain, the ordinal book wins outright.
    expect(deriveScriptureBook("1 John 4:8 and 1 John 5:1")).toBe("1JN");
    expect(deriveScriptureBook("1 John and 1 John 5")).toBe("1JN");
  });

  it("a bare book name resolves ONLY when it is the whole reference", () => {
    expect(deriveScriptureBook("Genesis")).toBe("GEN");
    expect(deriveScriptureBook("Genesis.")).toBe("GEN"); // trailing punctuation is fine
    expect(deriveScriptureBook("Read Genesis")).toBeNull();
    expect(deriveScriptureBook("Genesis account")).toBeNull();
  });

  it("rejects a translation parenthetical after a chapter-only reference (translation is its own field)", () => {
    // `translation` is a separate column and a separate request field, so a
    // parenthetical in the reference is redundant. "PSALM 23 (KJV)" is a 422 the client
    // fixes by dropping it; "PSALM 23:1 (KJV)" resolves because the verse punctuation
    // terminates the chapter number.
    expect(deriveScriptureBook("Psalm 23 (KJV)")).toBeNull();
    expect(deriveScriptureBook("Psalm 23:1 (KJV)")).toBe("PSA");
  });
});

// ---------------------------------------------------------------------------
// U-SB7c — the token-boundary guards, each isolated
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — token-boundary guards (U-SB7c)", () => {
  // Isolates the START guard's letter half. Without it, GEN matches inside these words
  // and the tail (" 1:1") is perfectly reference-shaped, so each would derive GEN.
  it("a book phrase inside a longer word never starts a match", () => {
    expect(deriveScriptureBook("Volkswagen 1:1")).toBeNull();
    expect(deriveScriptureBook("Morgen 1:1")).toBeNull();
    expect(deriveScriptureBook("hydrogen 1:1")).toBeNull();
    expect(deriveScriptureBook("Argentina 1:1")).toBeNull();
  });

  // Isolates the START guard's DIGIT half specifically.
  it("a book phrase preceded by a digit never starts a match", () => {
    expect(deriveScriptureBook("1GEN 1:1")).toBeNull();
    expect(deriveScriptureBook("23PSA 1:1")).toBeNull();
  });

  // *** FIXED IN THIS PASS, found by the regression sweep rather than by the audit ***
  // The `1st John` mis-file family, third direction. "1 JOHN" is a match phrase, so the
  // ordinal normally wins by longest-match — but when the digit is glued to a letter the
  // start guard refuses "1 JOHN", and the bare JOHN two characters on used to win: JHN, a
  // cross-book wrong facet. A bare name may no longer start immediately after "<digit> "
  // when "<digit> <name>" is itself a phrase.
  it("a bare book name never wins as the TAIL of an unreachable ordinal name", () => {
    expect(deriveScriptureBook("x1 john 1:1")).toBeNull(); // was JHN
    expect(deriveScriptureBook("23 John 1:1")).toBeNull(); // was JHN
    // Narrow by design. A series prefix must still resolve, because "5 PSALM" and
    // "3 GENESIS" are not phrases — only the John family is a suffix of an ordinal name.
    expect(deriveScriptureBook("Day 5 Psalm 23")).toBe("PSA");
    expect(deriveScriptureBook("Week 3 Genesis 1:1")).toBe("GEN");
    // ...and where the ordinal phrase CAN match at its own token start, nothing changes.
    expect(deriveScriptureBook("Day 3 John 3:16")).toBe("3JN");
    expect(deriveScriptureBook("See 1 John 4:8")).toBe("1JN");
    expect(deriveScriptureBook("#1 John 4:8")).toBe("1JN");
    expect(deriveScriptureBook("23. John 1:1")).toBe("JHN"); // a numbered list item
  });

  // The END guard. The first three are also rejected by the shape rule (a letter can
  // never open a valid tail), so they document the rule rather than isolate the guard;
  // the last one isolates it, because AND is a joiner and shape alone would accept
  // "GEN" + "AND EXODUS …" and answer GEN instead of moving on.
  it("a book phrase that is merely the head of a longer word never matches", () => {
    expect(deriveScriptureBook("Jobs 1:1")).toBeNull();
    expect(deriveScriptureBook("Romance 1:1")).toBeNull();
    expect(deriveScriptureBook("Psalter 23")).toBeNull();
    expect(deriveScriptureBook("GENAND EXODUS 1:1")).toBe("EXO");
  });

  it("still matches a phrase that ends immediately before a DIGIT (the USFM shape)", () => {
    expect(deriveScriptureBook("GEN1:1")).toBe("GEN");
    expect(deriveScriptureBook("PSA23")).toBe("PSA");
  });
});

// ---------------------------------------------------------------------------
// U-SB7d — the residual-audit decisions, pinned either way
// ---------------------------------------------------------------------------

// A reader must be able to tell a DECISION from an OVERSIGHT. These two blocks pin
// behaviour that a residual audit of 419bba5 flagged as undocumented and unpinned. Both
// are deliberately left AS THEY ARE; the one-line reason is on each block.
describe("Task #39 scripture-book — pinned residual decisions (U-SB7d)", () => {
  // W3 — ACCEPTED AS CORRECT. A separator-less chapter is required by the USFM/tight
  // spellings that must work ("GEN1:1", "PSA23"), and read tightly these strings ARE
  // references: "PS4" is Psalm 4, "MT2" is Matthew 2. Nothing else is a plausible
  // `scriptureReference`, so there is no mis-file to close here.
  it("pins the tight alias+digit form: `PS4` IS Psalm 4", () => {
    expect(deriveScriptureBook("PS4")).toBe("PSA");
    expect(deriveScriptureBook("PS5")).toBe("PSA");
    expect(deriveScriptureBook("MT2")).toBe("MAT");
    expect(deriveScriptureBook("HO2")).toBe("HOS");
    expect(deriveScriptureBook("JOB1")).toBe("JOB");
  });

  // W4 — ACCEPTED AS NULL (a loud 422, never a mis-file). A chapter number must be
  // terminated by end-of-string or reference punctuation, and NOT by a word: the rule
  // that would let "PSALM 23 KJV" through is the same rule that lets "PS I love you"
  // (normalized "PS 1 LOVE YOU") mis-file as PSA. `translation` is its own request field
  // and its own column, so the suffix is redundant, and prose connectors ("chapter",
  // "book of") are an open-ended vocabulary this module deliberately does not own.
  it("pins the trailing-word false negatives: a WORD never terminates a chapter", () => {
    expect(deriveScriptureBook("Psalm 23 KJV")).toBeNull();
    expect(deriveScriptureBook("Psalm 23 NIV")).toBeNull();
    expect(deriveScriptureBook("Genesis chapter 1")).toBeNull();
    expect(deriveScriptureBook("Book of Genesis")).toBeNull();
    expect(deriveScriptureBook("The Book of Genesis")).toBeNull();
    // The ASYMMETRY, pinned so it reads as understood rather than accidental: verse
    // punctuation terminates the number BEFORE the trailing word is ever examined, so
    // the same suffix is harmless here. The asymmetry only ever produces MORE nulls —
    // it can never produce a wrong code — which is why it is tolerable.
    expect(deriveScriptureBook("Psalm 119:105 ESV")).toBe("PSA");
    expect(deriveScriptureBook("Psalm 23:1 KJV")).toBe("PSA");
  });
});

// ---------------------------------------------------------------------------
// U-SB7e — W5: what the following-book terminator ALSO admits, pinned
// ---------------------------------------------------------------------------

// W5 — ACCEPTED AS-IS, and pinned here because nothing pinned it either way. The form-(b)
// rule "a following BOOK terminates a chapter number" (added to stop `"PSALM 23 JOHN 3:16"`
// answering JHN, U-SB7 above) also ADMITS these degenerate `<alias><sep><number> <alias>`
// strings, all of which derived null before it landed. Accepted rather than closed, and all
// three reasons are needed because no one of them carries it alone:
//   1. The forms are DEGENERATE. Nobody fills `scriptureReference` with `"Ho 2 Ho"`.
//   2. Every one answers the FIRST book named, so no widened form can be a CROSS-BOOK
//      mis-file — the only outcome this module treats as unrecoverable. Measured over 5,625
//      `<wordy-alias><sep><number> <wordy-alias>` probes: 4,500 resolve, 4,500 of those were
//      null before the terminator, and **0** answer anything but the first book named.
//   3. Tightening the rule means DELETING the fix, not narrowing it. Measured over the
//      82,369 `"<phrase> 23 <phrase> 3:16"` frames (287 match phrases squared), 80,006
//      answer the FIRST book today and answered a LATER, WRONG book without it.
// Trading 80,006 wrong-book strings for 4,500 degenerate non-null ones is not a trade this
// module's asymmetry (null = loud 422, wrong code = silent permanent mis-file) allows.
describe("Task #39 scripture-book — the following-book widening, pinned (U-SB7e)", () => {
  it("resolves the degenerate <alias> <number> <alias> forms to their FIRST book (W5)", () => {
    expect(deriveScriptureBook("Ho 2 Ho")).toBe("HOS");
    expect(deriveScriptureBook("Song 2 Song")).toBe("SNG");
    expect(deriveScriptureBook("Job 2 Job")).toBe("JOB");
    expect(deriveScriptureBook("PS 4 PS")).toBe("PSA");
    expect(deriveScriptureBook("Ho, 1 Ho")).toBe("HOS");
    // The invariant that makes the widening tolerable rather than a W1 repeat: with a
    // DIFFERENT second book it is still the FIRST one that answers.
    expect(deriveScriptureBook("Ho 3 John")).toBe("HOS");
  });

  it("...while the realistic prose next door still returns null (W5)", () => {
    // The widening is bounded by "only a recognized BOOK opens the door". Each of these
    // also puts a number after a word-like alias, and each still 422s.
    for (const ref of [
      "Ho ho, 1 more sleep",
      "PS, 1 more thing",
      "Song 1 of 2",
      "Chapter 1 Genesis",
      "Part 1 Job",
      "Amos 1 and Andy",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// U-SB7f — rules a mutation sweep found UNPINNED, now pinned
// ---------------------------------------------------------------------------

// Every accept/reject rule and guard in `scripture-book.ts` was deleted or widened one at a
// time and the suite re-run — 73 mutations, 46 of them already killed by the blocks above.
// These are the survivors that had REAL behaviour behind them: each assertion below is the
// one that goes red when its rule is removed. (The remaining survivors are behaviourally
// INERT — see the note at the end of this block.)
describe("Task #39 scripture-book — rules the mutation sweep found unpinned (U-SB7f)", () => {
  // The JOINER SET is closed at six characters plus the words AND/TO. `-`, `,`, `…`, AND and
  // TO are pinned by U-SB7; these three were not, so deleting any of them was free.
  it("pins the remaining form-(c) joiners: `;`, `&` and `/`", () => {
    expect(deriveScriptureBook("Genesis; Exodus 1:1")).toBe("GEN");
    expect(deriveScriptureBook("Genesis & Exodus 1:1")).toBe("GEN");
    expect(deriveScriptureBook("Genesis/Exodus 1:1")).toBe("GEN");
  });

  // The typographic-dash fold, ISOLATED. U-SB3's `"GENESIS 1:1–4"` does not isolate it —
  // there the verse colon terminates the chapter number before the dash is ever reached, so
  // the fold could be deleted and that test would stay green. A dash used as a JOINER is the
  // shape that needs it, because JOINER_RE knows only the folded ASCII `-`.
  it("pins the typographic-dash fold via a dash used as a JOINER", () => {
    expect(deriveScriptureBook("Genesis – Exodus 1:1")).toBe("GEN"); // en dash
    expect(deriveScriptureBook("Genesis — Exodus 1:1")).toBe("GEN"); // em dash
    expect(deriveScriptureBook("Genesis ‑ Exodus 1:1")).toBe("GEN"); // U+2011
  });

  // trim(), ISOLATED. U-SB6's `"  genesis   1:1 "` does not isolate it either: that resolves
  // through form (b), which does not care where the phrase starts. Form (a) BARE is the one
  // that demands a LITERAL position 0, so a bare book name wrapped in whitespace is the only
  // shape that breaks if trim() goes.
  it("pins trim() via a BARE book name with surrounding whitespace", () => {
    expect(deriveScriptureBook(" Genesis ")).toBe("GEN");
    expect(deriveScriptureBook("\n Genesis \t")).toBe("GEN");
    expect(deriveScriptureBook("  The Revelation  ")).toBe("REV");
  });

  // The rest of CHAPTER_TERMINATORS. `:` and `.` are pinned ("Psalm 23:1 KJV", "GEN.1.1");
  // `,`, `;` and `-` were not. Read these against W4's `"Psalm 23 KJV"` -> null: it is the
  // SAME asymmetry W4 pins for `:`, not a second one. Reference punctuation terminates the
  // number before the trailing word is ever examined, so a translation suffix is harmless
  // once anything at all separates it from the chapter.
  it("pins `,`, `;` and `-` as chapter terminators (W4's asymmetry, generalized)", () => {
    expect(deriveScriptureBook("Psalm 23, KJV")).toBe("PSA");
    expect(deriveScriptureBook("Psalm 23; KJV")).toBe("PSA");
    expect(deriveScriptureBook("Psalm 23-KJV")).toBe("PSA");
    // ...and the UNSEPARATED form is still the loud 422 that W4 pins.
    expect(deriveScriptureBook("Psalm 23 KJV")).toBeNull();
  });

  // The punctuation run CHAPTER_RE allows between a book name and its chapter number. Space,
  // `.` and `,` are pinned ("Psalm 23", "GEN.1.1", "1 John, 1 John"); `:`, `;` and `#` were
  // not. All three only ever add recall on a tight spelling — none can reach prose, because
  // a chapter NUMBER still has to follow.
  it("pins `:`, `;` and `#` between a book name and its chapter number", () => {
    expect(deriveScriptureBook("Psalm:23")).toBe("PSA");
    expect(deriveScriptureBook("Psalm;23")).toBe("PSA");
    expect(deriveScriptureBook("Psalm #23")).toBe("PSA");
  });

  // A joiner WORD must be a WHOLE word. Without the `(?![A-Z0-9])` lookaheads, AND/TO match
  // the head of a longer token and a digit behind it then reads as a chapter range.
  it("pins the whole-word requirement on the AND / TO joiners", () => {
    expect(deriveScriptureBook("Genesis 1 and2")).toBeNull();
    expect(deriveScriptureBook("Genesis 1 to2")).toBeNull();
    // ...while the real joiners still work, so the boundary is visible.
    expect(deriveScriptureBook("Genesis 1 and 2")).toBe("GEN");
    expect(deriveScriptureBook("Genesis 1 to 3")).toBe("GEN");
  });

  // The BOOK that terminates a chapter number must be a WHOLE book, and must be separated
  // from the number by a SPACE. Both halves are what keep the U-SB7e widening off prose:
  // without the end-boundary check `"Johnny"` terminates a chapter and `"Psalm 23 Johnny
  // 3:16"` derives PSA out of a sentence.
  it("pins the following-BOOK terminator's two guards (a whole book, and a space)", () => {
    expect(deriveScriptureBook("Psalm 23 Johnny 3:16")).toBeNull();
    expect(deriveScriptureBook("Genesis 1 Exodusy 2")).toBeNull();
    expect(deriveScriptureBook("Psalm 23John 3:16")).toBeNull();
    // ...against the shapes that DO resolve, so the boundary is visible rather than implied.
    expect(deriveScriptureBook("Psalm 23 John 3:16")).toBe("PSA");
    expect(deriveScriptureBook("Genesis 1 Exodus 2")).toBe("GEN");
  });

  // A possessive is skipped ON THE WALK, not only at its ends, and that is a CROSS-BOOK
  // guard rather than a nicety: without it the form-(c) chain stops dead at the `'S`, the
  // FIRST book is rejected, and the scan walks on to answer the SECOND one (JHN / SNG here).
  it("pins skipPossessive INSIDE a form-(c) chain (a cross-book guard)", () => {
    for (const ref of [
      "Genesis, John's, Exodus 1:1",
      "Genesis - John's - Exodus 1:1",
      "Genesis - Song of Solomon's - Exodus 1:1",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).toBe("GEN");
    }
    expect(deriveScriptureBook("Job's, John's, Genesis 1:1")).toBe("JOB");
  });

  // THE INERT SURVIVORS, recorded so the next auditor does not re-derive them. Eleven
  // mutations survive the suite AND make no behavioural difference at all — 0 differing
  // answers over a 253,462-string differential frame space:
  //   - `isOrdinalTail`'s `start < 2`, preceding-SPACE and preceding-DIGIT checks: all three
  //     are implied by the `PHRASE_SET.has(...)` test that follows them, because every
  //     multi-token match phrase is `<digit> <name>`.
  //   - `bookPhraseAt`'s length-overrun guard and `joinsAnotherReference`'s memo: pure
  //     performance (`String.startsWith` past the end is already false; the memo only avoids
  //     re-walking a suffix whose verdict is a property of the suffix).
  //   - MATCH_PHRASES' first-claimant-wins and its code/name/alias priority: inert *because*
  //     U-SB1's expanded-variant collision guard holds — with no variant claimed by two
  //     books, the claim order cannot change any code.
  //   - `NUMERIC_PREFIX_RE`'s `III|II|I` alternation order (the trailing lookahead already
  //     forces the longest), `scanForBook`'s non-committing inner loop (no phrase pair in
  //     today's table has a shorter member that is accepted where the longer is rejected),
  //     `deriveScriptureBook`'s empty-string early return (the scan loop is a no-op on "")
  //     and `isScriptureBookCode`'s `typeof` guard (`Set.has` of a non-string is false).
  // They are kept as documentation/defence-in-depth, like the MATCH_PHRASES sort in U-SB1.
  //
  // ONE SURVIVOR IS A KNOWN RESIDUAL AND IS DELIBERATELY NOT PINNED (W6). `:` is not a
  // joiner — and because the scan walks PAST a matched-but-rejected book, a chapter-free
  // first book followed by a NON-joiner separator hands the answer to the SECOND book:
  // `"Genesis: Exodus 1:1"` derives EXO. So do `"Genesis or Exodus 1:1"`,
  // `"Genesis (Exodus 1:1"`, `"Genesis vs Exodus 1:1"` and `"Genesis | Exodus 1:1"`. That is
  // the cross-book outcome the module says it must never produce, so it is NOT pinned as a
  // decision here. It is also not a one-character fix: adding `:` to JOINER_RE is measurably
  // safe (234,987 colon frames improve, 0 regress) but closes only the colon member, while
  // the general fix — refusing to walk past a rejected book — is what makes
  // `"Read Genesis 1:1, Exodus 2:2"` -> GEN work and would turn `"A song about Genesis 1:1"`
  // (GEN today) into null. It needs its own adjudication and its own sweep.
});

// ---------------------------------------------------------------------------
// U-SB8 — unrecognized -> null (the 422 path)
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — unrecognized -> null (U-SB8)", () => {
  it("returns null for empty, whitespace, punctuation and non-canonical text", () => {
    for (const ref of [
      "",
      "   ",
      "—",
      "–",
      "-",
      "a poem",
      // English prose must not trip a short alias (the reason 2-letter aliases that
      // are common English words — IS, AM, EX, LA — are deliberately NOT in the table).
      "this is a poem about nothing",
      "Book of Mormon 1:1",
      "Theodore",
      "1:1",
      "42",
      "Samuel 3:10", // ambiguous without a number: deliberately unresolved
      "Chronicles 1:1",
    ]) {
      expect(deriveScriptureBook(ref), JSON.stringify(ref)).toBeNull();
    }
  });

  // POLICY, pinned so a later reader can tell a decision from an oversight (the same
  // reason "Samuel 3:10" is pinned above).
  it("pins the ordinal-book policy: the NUMBER is required, the spelling is flexible", () => {
    // Flexible: digit, roman numeral (with or without a period), word, ordinal suffix.
    expect(deriveScriptureBook("1 Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("I Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("I. Corinthians 13")).toBe("1CO");
    expect(deriveScriptureBook("1st Corinthians 13")).toBe("1CO");
    // Required: without a number there is no honest answer. 1CO and 2CO are different
    // books and the column is a single-select facet, so guessing one would mis-file
    // half the time. Null -> 422 -> the client adds the number.
    expect(deriveScriptureBook("Corinthians 13:4")).toBeNull();
    expect(deriveScriptureBook("Corinthians")).toBeNull();
  });

  it("pins the two-letter-alias policy: `La 3:22` is NOT Lamentations", () => {
    // "LA", "IS", "AM", "EX", "MR" are real scripture abbreviations AND common English
    // words. They are deliberately absent from the alias table: a missing alias costs a
    // loud, client-fixable 422, while a wrong one silently mis-files a public item.
    expect(deriveScriptureBook("La 3:22")).toBeNull();
    expect(deriveScriptureBook("Is 53:5")).toBeNull();
    expect(deriveScriptureBook("Am 5:24")).toBeNull();
    expect(deriveScriptureBook("Ex 20:3")).toBeNull();
    // ...and the written-out forms of the same books resolve, so the cost is bounded.
    expect(deriveScriptureBook("Lamentations 3:22")).toBe("LAM");
    expect(deriveScriptureBook("Isaiah 53:5")).toBe("ISA");
    expect(deriveScriptureBook("Amos 5:24")).toBe("AMO");
    expect(deriveScriptureBook("Exodus 20:3")).toBe("EXO");
  });

  it("returns null for a non-string input rather than throwing", () => {
    expect(deriveScriptureBook(undefined as unknown as string)).toBeNull();
    expect(deriveScriptureBook(null as unknown as string)).toBeNull();
    expect(deriveScriptureBook(42 as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// U-SB9 — isScriptureBookCode
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — isScriptureBookCode (U-SB9)", () => {
  it("accepts every canonical code", () => {
    for (const book of SCRIPTURE_BOOKS) {
      expect(isScriptureBookCode(book.code), book.code).toBe(true);
    }
  });

  it("rejects a foreigner, an empty string and a non-string", () => {
    expect(isScriptureBookCode("XYZ")).toBe(false);
    expect(isScriptureBookCode("")).toBe(false);
    expect(isScriptureBookCode("GENESIS")).toBe(false);
    expect(isScriptureBookCode(undefined as unknown as string)).toBe(false);
  });

  it("is STRICT about case — callers normalize with deriveScriptureBook first", () => {
    expect(isScriptureBookCode("gen")).toBe(false);
    expect(deriveScriptureBook("gen")).toBe("GEN");
  });
});

// ---------------------------------------------------------------------------
// U-SB10 — purity
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — purity (U-SB10)", () => {
  it("is deterministic: the same input yields the same output every time", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(deriveScriptureBook("1 Corinthians 13:4")).toBe("1CO");
      expect(deriveScriptureBook("a poem")).toBeNull();
    }
  });

  it("reads no environment variable (works with process.env emptied)", () => {
    const saved = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      expect(deriveScriptureBook("Psalm 23")).toBe("PSA");
      expect(isScriptureBookCode("PSA")).toBe(true);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("reads no clock (works with Date replaced by a throwing stub)", () => {
    const RealDate = globalThis.Date;
    try {
      // Any `new Date()` / Date.now() inside the deriver would throw here.
      globalThis.Date = (() => {
        throw new Error("deriveScriptureBook must not read the clock");
      }) as unknown as DateConstructor;
      expect(deriveScriptureBook("GENESIS 1:1–4")).toBe("GEN");
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("terminates on a long, separator-dense reference (no runaway rescan)", () => {
    const dense = Array.from({ length: 40 }, () => "GEN 1:1").join(", ");
    expect(deriveScriptureBook(dense)).toBe("GEN");
    const denseMiss = Array.from({ length: 40 }, () => "nope and").join(" ");
    expect(deriveScriptureBook(denseMiss)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Barrel export (scripture-book is explicitly re-exported, not via `export *`)
// ---------------------------------------------------------------------------

describe("Task #39 scripture-book — barrel exports", () => {
  it("re-exports the whole surface from the package entry", () => {
    expect(typeof DbLib.deriveScriptureBook).toBe("function");
    expect(typeof DbLib.isScriptureBookCode).toBe("function");
    expect(Array.isArray(DbLib.SCRIPTURE_BOOKS)).toBe(true);
    expect(DbLib.SCRIPTURE_BOOKS).toHaveLength(66);
    expect(DbLib.deriveScriptureBook("1 Corinthians 13")).toBe("1CO");
  });

  it("keeps the matcher internals OUT of the package surface", () => {
    // `MATCH_PHRASES` / `phraseVariants` are exported from the module for the
    // table-integrity tests above, not for consumers — the public contract is the two
    // functions plus the book table.
    const barrel = DbLib as unknown as Record<string, unknown>;
    expect(barrel.MATCH_PHRASES).toBeUndefined();
    expect(barrel.phraseVariants).toBeUndefined();
  });
});
