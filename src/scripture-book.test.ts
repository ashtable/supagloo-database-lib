import { describe, expect, it } from "vitest";
// Namespace import of the barrel so the explicit re-export from src/index.ts is
// proven (scripture-book is NOT covered by `export * from "./schemas"`).
import * as DbLib from "./index";
import {
  SCRIPTURE_BOOKS,
  deriveScriptureBook,
  isScriptureBookCode,
} from "./scripture-book";

// Unit tests for the Task #39 shared scripture-book deriver (plan D6). DB-free,
// network-free, pure. The publish endpoint (`POST /v1/renders/:id/gallery`) turns a
// `null` derivation into a 422 `scripture_book_underivable`, so every case below is
// load-bearing for a real HTTP status. References in the wild come in TWO shapes —
// human (`"PSALM 23:2"`, `"GENESIS 1:1-4"`) and strict USFM (`"GEN.1.1"`, the shape the
// DBOS YouVersion client requires) — so the deriver must accept both.

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

  it("derives EVERY name and EVERY alias to its own book (cross-book collision guard)", () => {
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
    expect(deriveScriptureBook("Song of Solomon’s 2:1")).toBe("SNG");
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

  it("Song of Songs is SNG (the SONG prefix must not short-circuit the match)", () => {
    expect(deriveScriptureBook("Song of Songs 1:1")).toBe("SNG");
    expect(deriveScriptureBook("Canticles 1:1")).toBe("SNG");
  });

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

  it("does NOT fold a numeral that is merely the start of a word (Isaiah, Iron)", () => {
    expect(deriveScriptureBook("Isaiah 53:5")).toBe("ISA");
    expect(deriveScriptureBook("Ironsmith 1:1")).toBeNull();
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
    expect(deriveScriptureBook("song of songs 1:1")).toBe("SNG");
  });

  it("strips a leading THE only when what follows still resolves", () => {
    expect(deriveScriptureBook("The Revelation 21:4")).toBe("REV");
    expect(deriveScriptureBook("The Acts 2:1")).toBe("ACT");
    // "Theodore" must NOT become "odore" — and must not resolve at all.
    expect(deriveScriptureBook("Theodore")).toBeNull();
    expect(deriveScriptureBook("Theology 101")).toBeNull();
  });
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
});
