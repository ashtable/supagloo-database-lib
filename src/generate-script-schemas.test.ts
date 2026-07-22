import { describe, expect, it } from "vitest";
import * as DbLib from "./index";
import * as S from "./schemas";

// Task #30: the structured-output + input contracts the generateScript workflow reads.
// `GeneratedScriptSchema` is the `script`-kind LLM result (single-scene text — the
// scripture-text triple, §2.8). `GenerateScriptInputSchema` is the subset of
// `AiGeneration.input` this workflow needs (a generation `brief` + an optional
// `scripture` block whose presence triggers `fetchScripturePassage`). DB-free.

describe("Task #30 — GeneratedScriptSchema (single-scene text)", () => {
  const VALID = {
    scriptText: "For God so loved the world, that he gave his only begotten Son.",
    reference: "John 3:16",
    translation: "KJV",
  };

  it("accepts a valid single-scene script (any licensed translation)", () => {
    expect(S.GeneratedScriptSchema.safeParse(VALID).success).toBe(true);
    expect(
      S.GeneratedScriptSchema.safeParse({ ...VALID, translation: "NIV" }).success,
    ).toBe(true);
  });

  it("rejects a missing/empty scriptText, reference, or translation", () => {
    for (const key of ["scriptText", "reference", "translation"] as const) {
      expect(
        S.GeneratedScriptSchema.safeParse({ ...VALID, [key]: "" }).success,
        `rejects empty ${key}`,
      ).toBe(false);
      const { [key]: _drop, ...rest } = VALID;
      void _drop;
      expect(
        S.GeneratedScriptSchema.safeParse(rest).success,
        `rejects missing ${key}`,
      ).toBe(false);
    }
  });
});

describe("Task #30 — GenerateScriptInputSchema (AiGeneration.input subset)", () => {
  it("accepts input WITH a scripture block and defaults language to eng", () => {
    const parsed = S.GenerateScriptInputSchema.safeParse({
      brief: "Break this passage into a 3-scene vertical video.",
      scripture: { reference: "John 3:16", translation: "KJV" },
    });
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scripture?.language).toBe("eng");
    }
  });

  it("accepts input WITHOUT a scripture block (topic origin — no passage fetch)", () => {
    expect(
      S.GenerateScriptInputSchema.safeParse({ brief: "A video about hope." }).success,
    ).toBe(true);
  });

  it("tolerates extra keys the enqueue API (#31) may add (passthrough)", () => {
    const parsed = S.GenerateScriptInputSchema.safeParse({
      brief: "x",
      sceneId: "s1",
      somethingElse: 42,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty brief and a scripture block missing its reference", () => {
    expect(S.GenerateScriptInputSchema.safeParse({ brief: "" }).success).toBe(false);
    expect(
      S.GenerateScriptInputSchema.safeParse({
        brief: "x",
        scripture: { translation: "KJV" },
      }).success,
    ).toBe(false);
  });
});

describe("Task #30 — barrel exports", () => {
  it("re-exports the new schemas as usable Zod schemas", () => {
    for (const name of [
      "GeneratedScriptSchema",
      "GenerateScriptInputSchema",
      "ScripturePassageRequestSchema",
    ] as const) {
      const schema = (DbLib as unknown as Record<string, { safeParse?: unknown }>)[name];
      expect(schema, `${name} exported`).toBeDefined();
      expect(typeof schema?.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});
