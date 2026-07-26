/**
 * Shared scripture book-code derivation (design-delta §2.7, plan task #39 D6).
 *
 * `GalleryItem.scriptureBook` is a NON-NULL column that drives the gallery's
 * single-select book filter, but nothing in the platform produces it: the studio
 * carries a free-text `scriptureReference` written by a human. This module is the one
 * place that turns the second into the first, so the API (publish + the `book=` query
 * filter) and any future consumer normalize identically. It lives in `database-lib`
 * for the same reason `s3-keys.ts` and `semver.ts` do: one implementation, imported by
 * every service.
 *
 * References arrive in TWO shapes and both must work:
 *   - human   — `"Genesis 1:1"`, `"PSALM 23:2"`, `"GENESIS 1:1–4"`, `"1 Corinthians 13"`
 *   - USFM    — `"GEN.1.1"`, `"1CO.13.4"` (the strict form the DBOS YouVersion client
 *               requires, `supagloo-nodejs-dbos/src/providers/youversion.ts`)
 *
 * Algorithm (plan D6, exactly):
 *   1. Normalize — trim, collapse whitespace, uppercase, fold typographic dashes and
 *      apostrophes to ASCII, and fold numeric prefixes (`I`/`FIRST` → `1`, …).
 *   2. Scan left-to-right for the LONGEST book phrase matching at the EARLIEST
 *      position, over the USFM code, the full name and a curated alias set.
 *      Position beats length: `"Job 1:21, Philippians 4:13"` is JOB.
 *      Length beats greed at one position: `"1 John"` is 1JN, never JHN.
 *   3. Return the code, or `null`.
 *
 * MULTI-BOOK REFERENCES COLLAPSE TO THEIR FIRST BOOK. `"Genesis 1:1 – Exodus 2:2"`
 * derives `GEN`. The column is a single value driving a single-select facet and the
 * design has no multi-book concept; rejecting the publish would block a legitimate
 * cross-book video and a `MULTI` pseudo-code would put a non-book into a public facet.
 * Nothing is lost visually — the card renders `scriptureReference` verbatim, so only
 * the FILTER is coarsened to the first book.
 *
 * UNRECOGNIZED / EMPTY DERIVES `null`, and the publish endpoint answers
 * **422 `scripture_book_underivable`**. An `UNKNOWN` sentinel would be junk in a public
 * facet and silently dropping the item from the filter is a worse lie.
 *
 * MATCH PRECISION OVER RECALL. A missing alias produces a loud, client-fixable 422; a
 * WRONG alias silently mis-files a public gallery item forever. So the alias table
 * deliberately omits two-letter abbreviations that are also common English words
 * (`IS`, `AM`, `EX`, `LA`, `MR`) even though they are real scripture abbreviations.
 *
 * Every function here is pure: no environment read, no clock read, no I/O.
 */

/** One canonical book: its USFM code, its normalized full name, and the curated
 *  alternate spellings that resolve to it. `name` and `aliases` are MATCH phrases in
 *  normalized (uppercase) form — they are not display labels. */
export interface ScriptureBook {
  code: string;
  name: string;
  aliases: readonly string[];
}

/**
 * The 66 books of the protestant canon in canonical order, keyed by USFM code.
 * Numeric prefixes are stored in DIGIT form (`"1 CORINTHIANS"`); the `I`/`II`/`III`
 * and `FIRST`/`SECOND`/`THIRD` spellings are folded onto digits during normalization,
 * and the space-less/spaced variants (`"1CORINTHIANS"` / `"1 CO"`) are derived
 * mechanically, so neither needs an entry here.
 */
export const SCRIPTURE_BOOKS: readonly ScriptureBook[] = [
  // --- Old Testament ---------------------------------------------------------
  { code: "GEN", name: "GENESIS", aliases: ["GN", "GE"] },
  { code: "EXO", name: "EXODUS", aliases: ["EXOD"] },
  { code: "LEV", name: "LEVITICUS", aliases: ["LV", "LEVIT"] },
  { code: "NUM", name: "NUMBERS", aliases: ["NM", "NUMB"] },
  { code: "DEU", name: "DEUTERONOMY", aliases: ["DEUT", "DT"] },
  { code: "JOS", name: "JOSHUA", aliases: ["JOSH", "JSH"] },
  { code: "JDG", name: "JUDGES", aliases: ["JUDG", "JG"] },
  { code: "RUT", name: "RUTH", aliases: ["RTH", "RU"] },
  { code: "1SA", name: "1 SAMUEL", aliases: ["1 SAM"] },
  { code: "2SA", name: "2 SAMUEL", aliases: ["2 SAM"] },
  { code: "1KI", name: "1 KINGS", aliases: ["1 KGS", "1 KIN"] },
  { code: "2KI", name: "2 KINGS", aliases: ["2 KGS", "2 KIN"] },
  { code: "1CH", name: "1 CHRONICLES", aliases: ["1 CHR", "1 CHRON"] },
  { code: "2CH", name: "2 CHRONICLES", aliases: ["2 CHR", "2 CHRON"] },
  { code: "EZR", name: "EZRA", aliases: [] },
  { code: "NEH", name: "NEHEMIAH", aliases: ["NE"] },
  { code: "EST", name: "ESTHER", aliases: ["ESTH"] },
  { code: "JOB", name: "JOB", aliases: [] },
  { code: "PSA", name: "PSALMS", aliases: ["PSALM", "PS", "PSS", "PSLM"] },
  { code: "PRO", name: "PROVERBS", aliases: ["PROV", "PRV"] },
  { code: "ECC", name: "ECCLESIASTES", aliases: ["ECCL", "ECCLES", "QOHELETH"] },
  {
    code: "SNG",
    name: "SONG OF SOLOMON",
    aliases: ["SONG OF SONGS", "CANTICLES", "CANT", "SONG", "SOS", "SS"],
  },
  { code: "ISA", name: "ISAIAH", aliases: [] },
  { code: "JER", name: "JEREMIAH", aliases: ["JR"] },
  { code: "LAM", name: "LAMENTATIONS", aliases: [] },
  { code: "EZK", name: "EZEKIEL", aliases: ["EZEK", "EZE"] },
  { code: "DAN", name: "DANIEL", aliases: ["DN"] },
  { code: "HOS", name: "HOSEA", aliases: ["HO"] },
  { code: "JOL", name: "JOEL", aliases: ["JL"] },
  { code: "AMO", name: "AMOS", aliases: [] },
  { code: "OBA", name: "OBADIAH", aliases: ["OBAD", "OB"] },
  { code: "JON", name: "JONAH", aliases: ["JNH"] },
  { code: "MIC", name: "MICAH", aliases: ["MC"] },
  { code: "NAM", name: "NAHUM", aliases: ["NAH"] },
  { code: "HAB", name: "HABAKKUK", aliases: ["HABAK"] },
  { code: "ZEP", name: "ZEPHANIAH", aliases: ["ZEPH"] },
  { code: "HAG", name: "HAGGAI", aliases: ["HG"] },
  { code: "ZEC", name: "ZECHARIAH", aliases: ["ZECH"] },
  { code: "MAL", name: "MALACHI", aliases: ["ML"] },
  // --- New Testament ---------------------------------------------------------
  { code: "MAT", name: "MATTHEW", aliases: ["MATT", "MT"] },
  { code: "MRK", name: "MARK", aliases: ["MK"] },
  { code: "LUK", name: "LUKE", aliases: ["LK"] },
  { code: "JHN", name: "JOHN", aliases: ["JN"] },
  { code: "ACT", name: "ACTS", aliases: ["AC"] },
  { code: "ROM", name: "ROMANS", aliases: ["RM"] },
  { code: "1CO", name: "1 CORINTHIANS", aliases: ["1 COR"] },
  { code: "2CO", name: "2 CORINTHIANS", aliases: ["2 COR"] },
  { code: "GAL", name: "GALATIANS", aliases: ["GA"] },
  { code: "EPH", name: "EPHESIANS", aliases: ["EP"] },
  // `PHIL` is assigned to Philippians (the dominant convention); Philemon keeps the
  // longer `PHILEM`/`PHLM`, which win by longest-match wherever they are written out.
  { code: "PHP", name: "PHILIPPIANS", aliases: ["PHIL", "PHILIP"] },
  { code: "COL", name: "COLOSSIANS", aliases: ["COLOS"] },
  { code: "1TH", name: "1 THESSALONIANS", aliases: ["1 THESS", "1 THES"] },
  { code: "2TH", name: "2 THESSALONIANS", aliases: ["2 THESS", "2 THES"] },
  { code: "1TI", name: "1 TIMOTHY", aliases: ["1 TIM"] },
  { code: "2TI", name: "2 TIMOTHY", aliases: ["2 TIM"] },
  { code: "TIT", name: "TITUS", aliases: [] },
  { code: "PHM", name: "PHILEMON", aliases: ["PHILEM", "PHLM"] },
  { code: "HEB", name: "HEBREWS", aliases: [] },
  { code: "JAS", name: "JAMES", aliases: ["JM"] },
  { code: "1PE", name: "1 PETER", aliases: ["1 PET", "1 PT"] },
  { code: "2PE", name: "2 PETER", aliases: ["2 PET", "2 PT"] },
  { code: "1JN", name: "1 JOHN", aliases: ["1 JN", "1 JHN"] },
  { code: "2JN", name: "2 JOHN", aliases: ["2 JN", "2 JHN"] },
  { code: "3JN", name: "3 JOHN", aliases: ["3 JN", "3 JHN"] },
  { code: "JUD", name: "JUDE", aliases: ["JD"] },
  { code: "REV", name: "REVELATION", aliases: ["REVELATIONS", "RV", "APOCALYPSE"] },
];

const BOOK_CODES: ReadonlySet<string> = new Set(SCRIPTURE_BOOKS.map((b) => b.code));

/** Word-form numeric prefixes folded onto digits so the table only ever stores one
 *  spelling. Folded on WHOLE tokens only, so `ISAIAH` is never mangled into `1SAIAH`. */
const NUMERIC_PREFIXES: Readonly<Record<string, string>> = {
  I: "1",
  II: "2",
  III: "3",
  FIRST: "1",
  SECOND: "2",
  THIRD: "3",
};

const NUMERIC_PREFIX_RE = /(^|[^A-Z0-9])(III|II|I|FIRST|SECOND|THIRD)(?![A-Z0-9])/g;

/** `"1 CORINTHIANS"` also matches as `"1CORINTHIANS"`, and `"1CO"` also as `"1 CO"`.
 *  Derived mechanically so the table stays one spelling per phrase. */
function phraseVariants(phrase: string): string[] {
  const variants = [phrase];
  const spaced = /^(\d) (.+)$/.exec(phrase);
  if (spaced) variants.push(`${spaced[1]}${spaced[2]}`);
  const tight = /^(\d)([A-Z].*)$/.exec(phrase);
  if (tight) variants.push(`${tight[1]} ${tight[2]}`);
  return variants;
}

/** Every match phrase, longest first — the inner loop of the scan, so "longest match
 *  at a position" falls out of the iteration order. Built once at module load. */
const MATCH_PHRASES: ReadonlyArray<{ phrase: string; code: string }> = (() => {
  const byPhrase = new Map<string, string>();
  for (const book of SCRIPTURE_BOOKS) {
    // Priority: code, then name, then aliases. A phrase already claimed keeps its
    // first claimant, which makes the table order the tie-break rather than chance.
    for (const source of [book.code, book.name, ...book.aliases]) {
      for (const variant of phraseVariants(source)) {
        if (!byPhrase.has(variant)) byPhrase.set(variant, book.code);
      }
    }
  }
  return [...byPhrase.entries()]
    .map(([phrase, code]) => ({ phrase, code }))
    .sort((a, b) => b.phrase.length - a.phrase.length);
})();

function isUpperLetter(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** A match may only START at a token start: the preceding character must be neither a
 *  letter nor a digit, so `GEN` never matches inside `ARGENTINA` or `1GEN`. */
function startsAtTokenBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1] as string;
  return !isUpperLetter(prev) && !isDigit(prev);
}

/** A match may only END at a token end or immediately before a digit, so `PSA` never
 *  matches inside `PSALM` but `GEN` still matches in `GEN1:1` and `GEN.1.1`. */
function endsAtTokenBoundary(text: string, end: number): boolean {
  if (end === text.length) return true;
  return !isUpperLetter(text[end] as string);
}

/**
 * Uppercase, collapse whitespace, fold typographic punctuation to ASCII, and fold
 * word-form numeric prefixes onto digits. Pure string work — the output is the only
 * thing the matcher ever sees.
 */
function normalizeReference(reference: string): string {
  return reference
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(
      NUMERIC_PREFIX_RE,
      (_match, prefix: string, word: string) =>
        `${prefix}${NUMERIC_PREFIXES[word] as string}`,
    );
}

/** Earliest position wins; at a position, the longest phrase wins. */
function scanForBook(text: string): string | null {
  for (let i = 0; i < text.length; i += 1) {
    if (!startsAtTokenBoundary(text, i)) continue;
    for (const { phrase, code } of MATCH_PHRASES) {
      const end = i + phrase.length;
      if (end > text.length) continue;
      if (!text.startsWith(phrase, i)) continue;
      if (!endsAtTokenBoundary(text, end)) continue;
      return code;
    }
  }
  return null;
}

/**
 * Derive the USFM book code for a free-text scripture reference, or `null` if no book
 * can be recognized.
 *
 * Also the right way to normalize a client-supplied `book` filter value: it is
 * case-insensitive and accepts names as well as codes, so `deriveScriptureBook("gen")`
 * and `deriveScriptureBook("Genesis")` both yield `"GEN"` — unlike
 * {@link isScriptureBookCode}, which is a strict predicate over the canonical codes.
 *
 * @example deriveScriptureBook("GENESIS 1:1–4")        // "GEN"
 * @example deriveScriptureBook("1 Corinthians 13")     // "1CO"
 * @example deriveScriptureBook("GEN.1.1-EXO.2.2")      // "GEN"  (first book wins)
 * @example deriveScriptureBook("a poem")               // null   (publish 422s)
 */
export function deriveScriptureBook(reference: string): string | null {
  if (typeof reference !== "string") return null;

  const normalized = normalizeReference(reference);
  if (normalized.length === 0) return null;

  const direct = scanForBook(normalized);
  if (direct !== null) return direct;

  // Strip a leading `THE ` ONLY as a fallback — i.e. only when what follows still
  // resolves. `"Theodore"` has no trailing space after `THE`, and even if it did the
  // remainder would not resolve, so the strip can never turn a non-book into a book.
  if (normalized.startsWith("THE ")) return scanForBook(normalized.slice(4));

  return null;
}

/**
 * Strict predicate: is this exactly one of the 66 canonical USFM codes? Case-sensitive
 * by design — `"gen"` is false. Callers holding user input should normalize with
 * {@link deriveScriptureBook} first.
 */
export function isScriptureBookCode(code: string): boolean {
  return typeof code === "string" && BOOK_CODES.has(code);
}
