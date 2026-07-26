/**
 * Shared scripture book-code derivation (design-delta §2.7, plan task #39 D6).
 *
 * `GalleryItem.scriptureBook` is a NON-NULL column, but nothing in the platform
 * produces it: the studio carries a free-text `scriptureReference` written by a human.
 * This module is the one place that turns the second into the first, so the publish
 * endpoint and any future consumer normalize identically. It lives in `database-lib`
 * for the same reason `s3-keys.ts` and `semver.ts` do: one implementation, imported by
 * every service.
 *
 * WHAT `SCRIPTURE_BOOKS` IS — AND WHAT IT IS NOT. It is the set of book codes THIS
 * NORMALIZER CAN RECOGNIZE: the match vocabulary of {@link deriveScriptureBook}, used
 * only to populate the internal `scriptureBook` column. It is NOT a claim about which
 * books exist. WHICH BOOKS EXIST IS A PROPERTY OF THE TRANSLATION and the YouVersion
 * API is the authority on that — it varies per translation — so nothing here may be
 * read as this repo owning a canon. This module is a best-effort reference-string
 * normalizer with NO UI SURFACE: nothing filters or facets on the derived code (the
 * gallery listing offers sort + free-text search only).
 *
 * References arrive in TWO shapes and both must work:
 *   - human   — `"Genesis 1:1"`, `"PSALM 23:2"`, `"GENESIS 1:1–4"`, `"1 Corinthians 13"`
 *   - USFM    — `"GEN.1.1"`, `"1CO.13.4"` (the strict form the DBOS YouVersion client
 *               requires, `supagloo-nodejs-dbos/src/providers/youversion.ts`)
 *
 * Algorithm (plan D6, with the two departures documented below — THE PRICE, on number-
 * free ranges, and THE ARTICLE FORMS, on `THE `):
 *   1. Normalize — trim, collapse whitespace, uppercase, fold typographic dashes and
 *      apostrophes to ASCII, and fold numeric prefixes onto digits (`I`, `I.`, `FIRST`
 *      and `1ST` all become `1`; likewise for 2 and 3).
 *   2. Scan left-to-right for the LONGEST book phrase matching at the EARLIEST TOKEN
 *      START, over the USFM code, the full name and a curated alias set.
 *      Position beats length: `"Job 1:21, Philippians 4:13"` is JOB.
 *      Length beats greed at one position: `"1 John"` is 1JN, never JHN.
 *   3. A phrase only counts if what FOLLOWS it is shaped like the rest of a reference
 *      (THE REFERENCE-SHAPE RULE, below).
 *   4. Return the code, or `null`.
 *
 * THE REFERENCE-SHAPE RULE — the guard that keeps English prose out of the stored code.
 * Many of these names and aliases are also ordinary English words (`JOB`, `SONG`,
 * `PSALM`, `HO`, `PS`, `MT`, `AMOS`), so "a book name appears somewhere in the string"
 * is nowhere near enough — it derives SNG for `"a song about hope"` and MAT for
 * `"Mt Sinai"`. A phrase match is accepted only if, after optionally consuming a
 * possessive `'S` (`"Song of Solomon's 2:1"`), ONE of these holds:
 *
 *   (a) BARE — the phrase OPENS THE STRING and nothing alphanumeric follows it.
 *       `"Genesis"` and `"Genesis."` resolve; `"Read Genesis"` and `"A New Song"` do
 *       not, and `"Ho Ho Ho"` cannot resolve on its trailing `HO`. This is the ONLY form
 *       that accepts a reference with no chapter number at all, and it is why there is
 *       exactly ONE scan of exactly ONE string (see THE ARTICLE FORMS below).
 *   (b) CHAPTER — optional reference punctuation, then a chapter NUMBER, and that
 *       number terminated by end-of-string, by reference punctuation (`:`, `.`, `,`,
 *       `;`, `-`), by a joiner introducing another segment, or by ANOTHER BOOK.
 *       `"PSALM 23"`, `"PSALM 23:2"`, `"GEN.1.1"`, `"Genesis 1 to 3"` and
 *       `"PSALM 23 JOHN 3:16"` resolve. `"PS I love you"` does NOT: it normalizes to
 *       `"PS 1 LOVE YOU"`, so the chapter number is there but it runs straight into a
 *       WORD, and a word is not a terminator.
 *   (c) JOIN — a joiner onto ANOTHER REFERENCE SEGMENT: a book that carries its own chapter
 *       number, or a book joined onward to one. A joiner is ANY run of characters carrying
 *       no letter or digit — a space included — or one of the five words `AND`, `TO`,
 *       `THROUGH`, `OR`, `VS`, in any combination. `"Genesis - Exodus 1:1"`,
 *       `"Genesis: Exodus 1:1"` and `"Genesis Exodus 1:1"` are all GEN; `"Amos and Andy"`,
 *       `"Ho, hum"`, `"Ho, Ho, Ho"` and `"Romans…Ephesians"` are all null.
 *
 * WHY FORM (c) DEMANDS A CHAPTER FROM THE JOINED SEGMENT, and what that costs. Form (c)
 * exists to keep first-book-wins on a range whose FIRST segment has no chapter: without
 * it `"Genesis - Exodus 1:1"` answers EXO — a wrong code, strictly worse than a 422. But
 * asking only "is another book named after this joiner" is a shape ordinary English hits
 * constantly by repeating one word: `"Ho, Ho, Ho"`, `"Job, Job"`, `"Song, Song"` and
 * `"PS, PS"` each named a book, a joiner and a book, and each derived a real code onto a
 * public gallery item. Demanding that the joined chain REACH a chapter number is what
 * separates a real cross-book range from a repeated noun. Two cheaper rules were tried and
 * rejected — see {@link joinsAnotherReference}, where both are recorded, including the
 * one that re-opened the `"1st John"` CROSS-BOOK mis-file family.
 *
 * THE PRICE, stated plainly because it is a CONTRACT CHANGE from the first shipped
 * version: a CHAPTER-FREE book range no longer resolves. `"Romans…Ephesians"` was ROM and
 * `"Genesis - Exodus"` was GEN; both are now null -> 422. Such a range is an unusual way
 * to fill `scriptureReference`, the 422 names the offending value, and the client can
 * write `"Romans 1 - Ephesians 6"`. A silently mis-filed public gallery item is not
 * recoverable at all. Plan D6 requires multi-book -> FIRST book — which still holds for
 * every reference that reaches a chapter number, however long the chain
 * (`"Genesis - Exodus - Leviticus 1:1"` is GEN) — not that a chapter-free range be
 * accepted.
 *
 * THE ARTICLE FORMS are a CURATED ALIAS SET, not a `THE `-strip (DEVIATION from plan
 * D6's step 1, which said to strip a leading `THE ` whenever the remainder still
 * resolves). The strip re-scanned the article-less string, and that second scan has its
 * own position 0 — so form (a) fired on it, handing EVERY one-word book and alias a free
 * article-prefixed form: `"The Job"`, `"The Song"`, `"The Psalm"`, `"The Numbers"`,
 * `"The Judges"` all derived codes, ordinary English every one. Instead, the five titles
 * (across four books) whose conventional English form carries the definite article own it
 * as an explicit alias — `THE ACTS`, `THE REVELATION`, `THE SONG OF SOLOMON`,
 * `THE SONG OF SONGS`, `THE PSALMS`. The plan's two named cases (`"The Revelation"`
 * resolves, `"Theodore"` does not) hold exactly as specified; the set is CLOSED and
 * curated for the same reason
 * the alias table omits `IS`/`AM`/`EX` (see MATCH PRECISION OVER RECALL below). One
 * string, one scan, one position 0 — form (a)'s guarantee is now literally true.
 *
 * TWO FALSE-NEGATIVE CLASSES ARE DELIBERATE, and both are pinned in the tests so a
 * reader can tell a decision from an oversight:
 *   - A WORD never terminates a chapter number. `"Psalm 23 (KJV)"`, `"Psalm 23 KJV"`,
 *     `"Genesis chapter 1"` and `"Book of Genesis"` all derive null. `translation` is
 *     its own request field and its own column, so a translation suffix is redundant;
 *     prose connectors (`chapter`, `book of`) are an open-ended vocabulary this module
 *     does not own; and the rule that would admit them is the same rule that lets
 *     `"PS I love you"` mis-file as PSA. Note the asymmetry — `"Psalm 119:105 ESV"` DOES
 *     resolve, because the verse punctuation terminates the number before the trailing
 *     word is examined. It only ever produces MORE nulls, never a wrong code.
 *   - A separator-less chapter is ACCEPTED, and that is correct rather than tolerated:
 *     `"GEN1:1"` and `"PSA23"` require it, and read the same way `"PS4"` IS Psalm 4 and
 *     `"MT2"` IS Matthew 2. Nothing else is a plausible `scriptureReference`.
 *
 * MULTI-BOOK REFERENCES COLLAPSE TO THEIR FIRST BOOK. `"Genesis 1:1 – Exodus 2:2"`
 * derives `GEN`. The column holds a single value and the design has no multi-book
 * concept; rejecting the publish would block a legitimate cross-book video and a
 * `MULTI` pseudo-code would put a non-book code on a public gallery item.
 * Nothing is lost visually — the card renders `scriptureReference` verbatim, so only
 * the DERIVED CODE is coarsened to the first book. Note that "first" means first in the
 * STRING, not "first after some anchor": `"Read Genesis 1:1, Exodus 2:2"` is GEN, not
 * EXO. An anchoring rule that only allowed a match at position 0 (or after a joiner)
 * would answer EXO here — a wrong code, which is strictly worse than a 422.
 *
 * UNRECOGNIZED / EMPTY DERIVES `null`, and the publish endpoint answers
 * **422 `scripture_book_underivable`**. An `UNKNOWN` sentinel would be junk in a
 * non-null column on a public item; the 422 names the offending value and the client
 * can fix it.
 *
 * THE SEPARATOR NEVER DECIDES THE ANSWER (W6, closed 2026-07-26 — the last known mis-file
 * class in this module). Form (c) used to enumerate its joiners, and a chapter-free first
 * book followed by an UNLISTED separator failed the shape rule; the scan then walked past it
 * and answered the SECOND book. `"Genesis: Exodus 1:1"` derived EXO, as did the `or`, `vs`,
 * `(`, `|`, `+`, `!`, `?`, `", and"` and plain-SPACE spellings, and — through the possessive
 * skip — even `"Genesis'Song of Solomon 1:1"`. So did the chapter-BEARING form:
 * `"Psalm 23 | John 3:16"` derived JHN, where only the space spelling had been fixed. The
 * fix widens the NOTION of a joiner instead of listing members (see {@link JOINER_RE}); the
 * argument that makes it safe is positional — nothing standing between two BOOK PHRASES can
 * be verse punctuation. Measured over 1,736,925 differential probes against the previous
 * build: 638,959 answers moved to the FIRST book named, 0 moved to a later book, 0 became
 * null, and 1,435 chapter-range spellings (`"Psalm 23 : 2"`) became non-null. The remaining
 * residual is the WORD boundary, pinned as a decision in U-SB7g: an unlisted word does not
 * join, which is exactly what keeps `"A song about Genesis 1:1"` answering GEN.
 *
 * TWO MIS-FILES FOUND BY THE REGRESSION SWEEP OF THIS PASS, not by the audit, both
 * pre-existing and both now fixed because each answered the WRONG BOOK — the one outcome
 * that cannot be recovered once a public gallery item is filed:
 *   - `"PSALM 23 JOHN 3:16"` answered JHN. Two references written with no separator: the
 *     first chapter number ran into a word, so PSALM was rejected and the scan walked on
 *     to the SECOND book. A following BOOK now terminates a chapter number (form (b)), so
 *     the FIRST book wins as D6 requires. Only a recognized book opens that door, never
 *     any word, so `"PSALM 23 KJV"` is still null.
 *   - `"X1 JOHN 1:1"` answered JHN. See {@link isOrdinalTail}: with the digit glued to a
 *     letter the ordinal phrase `"1 JOHN"` cannot match at a token start, and the bare
 *     `JOHN` behind it won. This is the `"1st John"` family reached from a third
 *     direction, and it is now closed structurally rather than masked by match order.
 *
 * MATCH PRECISION OVER RECALL. A missing alias produces a loud, client-fixable 422; a
 * WRONG alias silently mis-files a public gallery item forever. So the alias table
 * deliberately omits two-letter abbreviations that are also common English words
 * (`IS`, `AM`, `EX`, `LA`, `MR`) even though they are real scripture abbreviations, and
 * an ordinal book requires its NUMBER — `"Corinthians 13:4"` derives null, because 1CO
 * and 2CO are different books and a guess would mis-file half the time.
 *
 * Every function here is pure: no environment read, no clock read, no I/O.
 */

/** One recognized book: its USFM code, its normalized full name, and the curated
 *  alternate spellings that resolve to it. `name` and `aliases` are MATCH phrases in
 *  normalized (uppercase) form — they are not display labels. */
export interface ScriptureBook {
  code: string;
  name: string;
  aliases: readonly string[];
}

/**
 * The 66 book codes this normalizer recognizes, in conventional order, keyed by USFM
 * code. A MATCH VOCABULARY, not a canon: which books a given translation contains is
 * YouVersion's to answer, not this table's (see the module header).
 * Numeric prefixes are stored in DIGIT form (`"1 CORINTHIANS"`); the `I`/`II`/`III`
 * and `FIRST`/`SECOND`/`THIRD` spellings are folded onto digits during normalization,
 * and the space-less/spaced variants (`"1CORINTHIANS"` / `"1 CO"`) are derived
 * mechanically, so neither needs an entry here.
 *
 * The five `THE …` aliases are the article-bearing conventional titles (see THE ARTICLE
 * FORMS in the module header). They are aliases rather than a general `THE `-strip
 * because the strip gave every one-word book a free article-prefixed prose form; this
 * set is CLOSED, and each member is a whole conventional title, not `THE ` + any book.
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
  { code: "PSA", name: "PSALMS", aliases: ["PSALM", "PS", "PSS", "PSLM", "THE PSALMS"] },
  { code: "PRO", name: "PROVERBS", aliases: ["PROV", "PRV"] },
  { code: "ECC", name: "ECCLESIASTES", aliases: ["ECCL", "ECCLES", "QOHELETH"] },
  {
    code: "SNG",
    name: "SONG OF SOLOMON",
    aliases: [
      "SONG OF SONGS",
      "CANTICLES",
      "CANT",
      "SONG",
      "SOS",
      "SS",
      "THE SONG OF SOLOMON",
      "THE SONG OF SONGS",
    ],
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
  { code: "ACT", name: "ACTS", aliases: ["AC", "THE ACTS"] },
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
  {
    code: "REV",
    name: "REVELATION",
    aliases: ["REVELATIONS", "RV", "APOCALYPSE", "THE REVELATION"],
  },
];

const BOOK_CODES: ReadonlySet<string> = new Set(SCRIPTURE_BOOKS.map((b) => b.code));

/** Non-digit numeric prefixes folded onto digits so the table only ever stores one
 *  spelling. Folded on WHOLE tokens only, so `ISAIAH` is never mangled into `1SAIAH`.
 *
 *  The ORDINAL-SUFFIX forms are here because without them `"1st John 4:8"` derived
 *  `JHN`: the unrecognized `1ST` token was skipped and the bare `JOHN` behind it won.
 *  A wrong non-null code is written straight to the non-null column of a public gallery
 *  item, so this is the one mis-file class the module cannot tolerate.
 *  (`1st Corinthians` merely degraded to null — a loud 422 — because no bare
 *  `CORINTHIANS` phrase exists; the John family is the family that mis-filed.) */
const NUMERIC_PREFIXES: Readonly<Record<string, string>> = {
  I: "1",
  II: "2",
  III: "3",
  FIRST: "1",
  SECOND: "2",
  THIRD: "3",
  "1ST": "1",
  "2ND": "2",
  "3RD": "3",
};

/** The optional `\.?` folds the numbered-list spelling of a roman numeral
 *  (`"I. Corinthians 13"`), dropping the period so the digit sits directly against the
 *  book name. The trailing `(?![A-Z0-9])` is what keeps `ISAIAH` and `21ST` intact. */
const NUMERIC_PREFIX_RE =
  /(^|[^A-Z0-9])(III|II|I|FIRST|SECOND|THIRD|1ST|2ND|3RD)\.?(?![A-Z0-9])/g;

/** `"1 CORINTHIANS"` also matches as `"1CORINTHIANS"`, and `"1CO"` also as `"1 CO"`.
 *  Derived mechanically so the table stays one spelling per phrase.
 *
 *  Exported for the table-integrity tests only (it is deliberately NOT re-exported
 *  from `src/index.ts`): the cross-book collision guard has to run over this EXPANDED
 *  space, because {@link MATCH_PHRASES} resolves a duplicate variant
 *  first-claimant-wins and would otherwise swallow a collision silently. */
export function phraseVariants(phrase: string): string[] {
  const variants = [phrase];
  const spaced = /^(\d) (.+)$/.exec(phrase);
  if (spaced) variants.push(`${spaced[1]}${spaced[2]}`);
  const tight = /^(\d)([A-Z].*)$/.exec(phrase);
  if (tight) variants.push(`${tight[1]} ${tight[2]}`);
  return variants;
}

/** Every match phrase, longest first — the inner loop of the scan, so "longest match
 *  at a position" falls out of the iteration order and does NOT depend on the order
 *  aliases happen to be written in. Built once at module load.
 *
 *  Exported for the table-integrity tests only (not re-exported from `src/index.ts`).
 *  With the reference-shape rule in place no input isolates the sort behaviourally —
 *  every mid-word cut is independently rejected because a letter can never open a valid
 *  tail — so the sort is pinned structurally instead of being left for a "this looks
 *  redundant" cleanup to delete. */
export const MATCH_PHRASES: ReadonlyArray<{ phrase: string; code: string }> = (() => {
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
 *  letter nor a digit, so `GEN` never matches inside `ARGENTINA`/`VOLKSWAGEN` (the
 *  letter half) or `1GEN` (the digit half). Both halves are load-bearing — without
 *  them those strings derive GEN, because their ` 1:1` tail is perfectly
 *  reference-shaped. */
function startsAtTokenBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1] as string;
  return !isUpperLetter(prev) && !isDigit(prev);
}

/** A match may only END at a word end or immediately before a digit, so `PSA` never
 *  matches inside `PSALM` but `GEN` still matches in `GEN1:1` and `GEN.1.1`.
 *
 *  Mostly belt-and-braces: the reference-shape rule independently rejects a mid-word
 *  cut, because the letter that follows can open none of its three forms. The one shape
 *  it does NOT cover is a cut landing immediately before a JOINER — `AND`/`TO` are
 *  words, so `"GENAND EXODUS 1:1"` would be accepted on shape alone and answer GEN
 *  instead of moving on to EXO. */
function endsAtTokenBoundary(text: string, end: number): boolean {
  if (end === text.length) return true;
  return !isUpperLetter(text[end] as string);
}

/** Every match phrase as a set, for the ordinal-tail guard below. */
const PHRASE_SET: ReadonlySet<string> = new Set(MATCH_PHRASES.map((p) => p.phrase));

/** Is the phrase spanning `[start, end)` merely the BARE NAME inside an ordinal book
 *  name whose digit sits at `start - 2`?
 *
 *  THE `1st John` MIS-FILE FAMILY, closed from its third direction. `"1 JOHN"` is a match
 *  phrase, so `"1 John 4:8"` resolves to 1JN by longest-match — but only while the ordinal
 *  phrase can match at all. In `"X1 JOHN 1:1"` the digit is glued to a letter, so the
 *  start-boundary guard refuses `"1 JOHN"`, and the bare `JOHN` two characters later wins:
 *  JHN, a CROSS-BOOK wrong code in a non-null column on a public item. (The same family produced
 *  `"1st John"` -> JHN before {@link NUMERIC_PREFIXES}, and `"1GEN 1:1"` -> GEN before the
 *  digit half of {@link startsAtTokenBoundary}.)
 *
 *  Deliberately NARROW: it fires only when `<digit> <phrase>` is itself a real match
 *  phrase, which today is only the John family (`JOHN`, `JN`, `JHN`). So a legitimate
 *  series prefix keeps working — `"Day 5 Psalm 23"` is PSA and `"Week 3 Genesis 1:1"` is
 *  GEN, because `"5 PSALM"` and `"3 GENESIS"` are not phrases — and `"Day 3 John 3:16"` is
 *  3JN either way, because there the ordinal phrase DOES match at its own token start. */
function isOrdinalTail(text: string, start: number, end: number): boolean {
  if (start < 2) return false;
  if (text[start - 1] !== " ") return false;
  if (!isDigit(text[start - 2] as string)) return false;
  return PHRASE_SET.has(text.slice(start - 2, end));
}

/** A joiner between two reference SEGMENTS: any run of characters carrying no letter or
 *  digit, or one of five whole words, in any combination (`", and "` is one joiner).
 *
 *  THE NOTION IS GENERAL RATHER THAN A LIST OF MEMBERS, and that is the fix for W6 (found
 *  2026-07-26 by a mutation audit, closed here). The old set was six characters plus
 *  `AND`/`TO`, with `:` deliberately excluded as "verse punctuation INSIDE one reference".
 *  The exclusion was wrong at THIS position, and the cost was a CROSS-BOOK MIS-FILE: a
 *  chapter-free first book followed by an unlisted separator failed the shape rule, the scan
 *  walked PAST it, and the SECOND book answered — `"Genesis: Exodus 1:1"` derived EXO, and so
 *  did the `or`, `vs`, `(`, `|`, `+`, `!`, `?`, `", and"` and plain-SPACE spellings.
 *  Measured over 1,093,592 two-book frames at 657234b: 642,339 answered a book that was not
 *  the first one named.
 *
 *  WHY THE GENERAL RULE IS SOUND, in one sentence: verse punctuation lives between a NUMBER
 *  and a NUMBER, so nothing standing between two BOOK PHRASES can be verse punctuation —
 *  which is the only position this regex is ever asked about. Enumerating `:` instead (the
 *  cheap fix) was measurably safe but closed one member and left the next unlisted separator
 *  reopening the identical hole; a plain space is a member too, and it is the same adjacency
 *  form (b) already accepts in `"Psalm 23 John 3:16"` -> PSA.
 *
 *  Two things this does NOT widen, both load-bearing:
 *   - The chain must still REACH A CHAPTER NUMBER ({@link joinsAnotherReference}), which is
 *     what keeps every W1 string (`"Ho, Ho, Ho"`, `"Ho: Ho"`, `"Song, Song"`) null.
 *   - A WORD is a joiner only if it is one of these five. An unlisted word between two books
 *     does NOT join them, so the left phrase stays prose and the scan walks on:
 *     `"A song about Genesis 1:1"` is GEN. That boundary is deliberate and pinned (U-SB7g) —
 *     `"Genesis then Exodus 1:1"` is EXO — because an English connector vocabulary is not
 *     something this module owns, the same line it draws for chapter terminators. The WORD
 *     set is therefore CLOSED by the same argument as the alias table: `AND`/`TO`/`THROUGH`
 *     are range words, `OR`/`VS` are choice words, and `THRU` is deliberately out.
 *
 *  Typographic dashes are still folded to ASCII `-` by {@link normalizeReference}: they no
 *  longer need to be for THIS regex, but `-` is also a {@link CHAPTER_TERMINATORS} member,
 *  where the fold is what makes `"Psalm 23–KJV"` resolve. */
const JOINER_RE = /^(?:[^A-Z0-9]|(?:AND|TO|OR|VS|THROUGH)(?![A-Z0-9]))+/;

/** Reference punctuation that may sit between a book name and its chapter number. */
const CHAPTER_RE = /^[ .:,;#]*(\d+)/;

/** What may terminate a chapter number: verse/range/list punctuation. */
const CHAPTER_TERMINATORS = ":.,;-";

/** The index just past a joiner (and its surrounding spaces) at `index`, or `null`. */
function joinerEndAt(text: string, index: number): number | null {
  const m = JOINER_RE.exec(text.slice(index));
  return m === null ? null : index + m[0].length;
}

/** The book phrase at `index` — which book, and where the phrase ends — or `null` if none
 *  starts here.
 *
 *  MATCH_PHRASES is longest-first, so this reports the LONGEST book named here, which is
 *  the one the scan itself would pick if it reached this position. */
function bookPhraseAt(
  text: string,
  index: number,
): { code: string; end: number } | null {
  for (const { phrase, code } of MATCH_PHRASES) {
    const end = index + phrase.length;
    if (end > text.length) continue;
    if (text.startsWith(phrase, index) && endsAtTokenBoundary(text, end)) {
      return { code, end };
    }
  }
  return null;
}

/** A possessive belongs to the book phrase: `"Song of Solomon's 2:1"` is a reference to
 *  SNG. Matching the ASCII form only is what makes {@link normalizeReference}'s
 *  curly-apostrophe fold observable at all.
 *
 *  The `'S` must END A TOKEN, exactly as {@link endsAtTokenBoundary} demands of a phrase: a
 *  LETTER after it means that `S` opens the next word and there is no possessive here. This
 *  is W6's last member and it is a CROSS-BOOK one: in `"Genesis'Song of Solomon 1:1"` the
 *  unconditional skip ate the `'S` of `SONG`, so the form-(c) chain started mid-word at
 *  `"ONG OF SOLOMON 1:1"`, GENESIS was rejected, and the scan answered SNG. A DIGIT after it
 *  is still fine — a chapter number may sit tight against a phrase (`"Psalm's23"`) — which is
 *  the same latitude the end-boundary guard gives. */
function skipPossessive(text: string, index: number): number {
  if (!text.startsWith("'S", index)) return index;
  const after = index + 2;
  return isUpperLetter((text[after] ?? "") as string) ? index : after;
}

/** Does a joiner at `index` introduce another book OR another number? Used only AFTER a
 *  chapter number has already proved reference shape, where `"Genesis 1 to 3"` and
 *  `"Genesis 1 and Exodus 2"` are both real references. A bare number is NOT enough in
 *  form (c) — `"Ho, 3 blind mice"` must stay null.
 *
 *  THE ONE PLACE {@link JOINER_RE}'s general notion IS NARROWED, and the narrowing is
 *  positional, like the notion itself: onto another BOOK anything separates (that segment
 *  names a book, so it is a reference), but onto another NUMBER a run of plain SPACES does
 *  NOT, because a chapter RANGE is always written with a real separator (`1-3`, `1 to 3`).
 *  Without that line `"Job 30 000"` derives JOB and `"Psalm 23 2024"` derives PSA — two
 *  numbers with nothing between them are prose, not a range. Measured: dropping it turns
 *  1,148 of 4,592 `"<phrase> 23<tail>"` probes from null into a code, every one of them a
 *  bare-space-then-number shape.
 *
 *  ITS PRICE, MEASURED AND ACCEPTED: `"Genesis 23 1 Exodus 3:16"` answers EXO — a chapter
 *  number, a SECOND bare number, and only then another book, so the first book's tail is
 *  unrecognizable and the scan walks on. 4,225 such frames remain, exactly as many as before
 *  this pass (the narrowing takes nothing away that used to work). Dropping the narrowing
 *  would close them, and that trade is refused deliberately: `"<book> <n> <n> <book> <ch>"`
 *  is not a shape English or a reference produces, while `"<book> <n> <n>"` IS a prose shape,
 *  and keeping prose out of the stored code is what this module is for. Two references written
 *  with no separator at all still work, because the joiner-onto-a-BOOK branch above is not
 *  narrowed: `"Psalm 23 1 John 3:16"` is PSA. */
function joinsAnotherSegment(text: string, index: number): boolean {
  const after = joinerEndAt(text, index);
  if (after === null) return false;
  if (bookPhraseAt(text, after) !== null) return true;
  if (!/[^ ]/.test(text.slice(index, after))) return false;
  return isDigit((text[after] ?? "") as string);
}

/** FORM (b) of the shape rule, in isolation: does a properly terminated chapter NUMBER
 *  follow the book phrase that ended at `end`?
 *
 *  Extracted so form (c) can reuse it on the segments it walks — "is this tail a
 *  reference" and "is that a reference segment" are the same question, and asking it with
 *  one function is what keeps the two forms from drifting apart. */
function hasChapterTail(text: string, end: number): boolean {
  const i = skipPossessive(text, end);
  const chapter = CHAPTER_RE.exec(text.slice(i));
  if (chapter === null) return false;
  const after = i + (chapter[0] as string).length;
  if (after === text.length) return true;
  if (CHAPTER_TERMINATORS.includes(text[after] as string)) return true;
  if (joinsAnotherSegment(text, after)) return true;
  // A following BOOK terminates the number too. `"PSALM 23 JOHN 3:16"` is two references
  // written with no separator between them; before this, PSALM was REJECTED here and the
  // scan walked on to answer JHN — the SECOND book, i.e. a wrong code, which is the one
  // outcome this module must never produce (D6: multi-book -> FIRST book). A following
  // WORD still does not terminate a number, so `"PSALM 23 KJV"` stays null and
  // `"PS I love you"` (normalized `"PS 1 LOVE YOU"`) cannot use this door: only a
  // recognized BOOK opens it.
  const spaces = /^ +/.exec(text.slice(after));
  return spaces !== null && bookPhraseAt(text, after + spaces[0].length) !== null;
}

/** FORM (c) of the shape rule: does a joiner at `index` introduce ANOTHER REFERENCE
 *  SEGMENT — a book carrying its own chapter number, or a book joined onward to one?
 *
 *  This is the rule W6's fix deliberately left ALONE. Widening which separators can join
 *  (see {@link JOINER_RE}) is safe only because the chain still has to reach a chapter, and
 *  every W1 string below is null for that reason and no other — measured over 660,387
 *  chapter-free two- and three-link probes, the widening changed exactly 0 answers.
 *
 *  The original form (c) asked only "is another book named after this joiner", and that
 *  is the weakness a residual audit shot down: English repeats one word constantly, so
 *  `"Ho, Ho, Ho"`, `"Job, Job"`, `"Song, Song"` and `"PS, PS"` all read as
 *  book-joiner-book and all derived a real code onto a public gallery item. Requiring the joined
 *  chain to REACH A CHAPTER NUMBER is what separates `"Genesis - Exodus 1:1"` (a real
 *  cross-book range whose first segment has no chapter) from a repeated noun.
 *
 *  Two cheaper rules were tried first and REJECTED, both recorded here so they are not
 *  re-invented: "the string must contain a digit somewhere" still accepted
 *  `"Song and song, take 2"`, where the digit belongs to neither book; and "the joined
 *  book must be a DIFFERENT book" opened a strictly WORSE hole — with `"1 JOHN"` rejected
 *  at position 0 for joining back onto itself, `"1 John and 1 John"` fell through to the
 *  bare `JOHN` at index 2, whose join onto 1JN now looked like a different book, and
 *  answered JHN. That is the `"1st John"` mis-file family all over again: a CROSS-BOOK
 *  wrong code, far worse than the prose it was meant to close.
 *
 *  Walked ITERATIVELY, and every index visited is memoized with the chain's verdict —
 *  reaching a chapter is a property of the whole suffix, so one walk settles every
 *  position on it. That keeps a hostile, separator-dense string linear, which is the cost
 *  worry that made the original probe deliberately shallow. */
function joinsAnotherReference(
  text: string,
  index: number,
  memo: Map<number, boolean>,
): boolean {
  const visited: number[] = [];
  let cursor = joinerEndAt(text, index);
  let result = false;
  while (cursor !== null) {
    const cached = memo.get(cursor);
    if (cached !== undefined) {
      result = cached;
      break;
    }
    visited.push(cursor);
    const book = bookPhraseAt(text, cursor);
    if (book === null) break;
    if (hasChapterTail(text, book.end)) {
      result = true;
      break;
    }
    cursor = joinerEndAt(text, skipPossessive(text, book.end));
  }
  for (const visit of visited) memo.set(visit, result);
  return result;
}

/**
 * THE REFERENCE-SHAPE RULE (see the module header). Is what follows a matched book
 * phrase shaped like the rest of a scripture reference? This is the guard that keeps
 * ordinary English prose — `"a psalm of thanksgiving"`, `"Mt Sinai"`,
 * `"Job interview at 9"`, `"Ho, Ho, Ho"` — from silently mis-filing a public gallery
 * item.
 *
 * @param start where the phrase began, needed because the BARE form is only legal when
 *              the book name opens the string.
 * @param memo shared with the rest of the scan; see {@link joinsAnotherReference}.
 */
function hasReferenceShapedTail(
  text: string,
  start: number,
  end: number,
  memo: Map<number, boolean>,
): boolean {
  const i = skipPossessive(text, end);

  // (a) BARE — the whole string is the book name, modulo trailing punctuation.
  if (start === 0 && !/[A-Z0-9]/.test(text.slice(i))) return true;

  // (b) CHAPTER — a chapter number, properly terminated.
  if (hasChapterTail(text, end)) return true;

  // (c) JOIN — a joiner onto another reference SEGMENT: "Genesis - Exodus 1:1" is GEN.
  return joinsAnotherReference(text, i, memo);
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

/**
 * Earliest token start wins; at a position, the longest phrase wins; and a phrase only
 * counts if its tail is reference-shaped.
 *
 * The scan does NOT commit to the first phrase that matches at a position — it keeps
 * going until one is ACCEPTED. That matters: in `"Song of Songs 1:1"` the 4-char `SONG`
 * alias matches at position 0 and its tail (`" OF SONGS 1:1"`) is prose, so a
 * committing matcher would answer null.
 */
function scanForBook(text: string): string | null {
  // One memo for the whole scan: every form-(c) chain walk records the suffixes it
  // visited, so a separator-dense string is walked once rather than once per position.
  const joinMemo = new Map<number, boolean>();
  for (let i = 0; i < text.length; i += 1) {
    if (!startsAtTokenBoundary(text, i)) continue;
    for (const { phrase, code } of MATCH_PHRASES) {
      const end = i + phrase.length;
      if (end > text.length) continue;
      if (!text.startsWith(phrase, i)) continue;
      if (!endsAtTokenBoundary(text, end)) continue;
      if (isOrdinalTail(text, i, end)) continue;
      if (!hasReferenceShapedTail(text, i, end, joinMemo)) continue;
      return code;
    }
  }
  return null;
}

/**
 * Derive the USFM book code for a free-text scripture reference, or `null` if no book
 * can be recognized.
 *
 * Case-insensitive, and it accepts names as well as codes, so
 * `deriveScriptureBook("gen")` and `deriveScriptureBook("Genesis")` both yield `"GEN"`
 * — unlike {@link isScriptureBookCode}, a strict predicate over the codes this module
 * recognizes.
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

  // ONE string, ONE scan. There used to be a second scan of the string with a leading
  // `THE ` removed, which is what made `"The Revelation"` work — and, because that
  // second scan brought its own position 0, what also made `"The Job"`, `"The Song"`,
  // `"The Psalm"`, `"The Numbers"` and `"The Judges"` derive book codes out of ordinary
  // English. The article-bearing titles are curated aliases now (see the module header),
  // so form (a)'s "opens the string" is a single, literal condition again.
  return scanForBook(normalized);
}

/**
 * Strict predicate: is this exactly one of the 66 USFM codes this module recognizes?
 * Case-sensitive
 * by design — `"gen"` is false. Callers holding user input should normalize with
 * {@link deriveScriptureBook} first.
 */
export function isScriptureBookCode(code: string): boolean {
  return typeof code === "string" && BOOK_CODES.has(code);
}
