import { describe, expect, it } from "vitest";
import * as lib from "./index";

// The public entry point. Requires `prisma generate` to have populated
// src/generated/prisma (part of `npm run build`), because index re-exports the
// generated client. The full dist -> pack -> install -> import surface is proven
// separately in tests/e2e/pack-install.e2e.ts.

describe("package entry (@supagloo/database-lib)", () => {
  it("exports PRISMA_VERSION", () => {
    expect(typeof lib.PRISMA_VERSION).toBe("string");
    expect(lib.PRISMA_VERSION.length).toBeGreaterThan(0);
  });

  it("re-exports the generated Prisma client (PrismaClient)", () => {
    expect(typeof lib.PrismaClient).toBe("function");
  });
});
