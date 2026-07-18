import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  SecretCryptoError,
} from "./secrets";

// Unit tests for the application-level secrets primitive (design-delta §2.10).
// AES-256-GCM, 12-byte random nonce per value, 32-byte key supplied as a 64-char
// hex string, packed as base64( 0x01 | iv[12] | tag[16] | ciphertext ). No DB.

// A valid 32-byte key as 64 hex chars, and a second distinct valid key.
const KEY = randomBytes(32).toString("hex");
const KEY2 = randomBytes(32).toString("hex");

const HEADER_BYTES = 1 + 12 + 16; // version + iv + tag
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Decode a stored ciphertext string back to its packed bytes.
function unpack(payload: string): Buffer {
  return Buffer.from(payload, "base64");
}

// Re-encode packed bytes as a stored ciphertext string (for tamper tests).
function pack(bytes: Buffer): string {
  return bytes.toString("base64");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips representative secrets and edge-case strings", () => {
    for (const pt of [
      "sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef",
      "gloo_client_secret_A1b2C3d4",
      "unicode: café ☕ 🔐 日本語",
      "",
    ]) {
      const ciphertext = encryptSecret(pt, KEY);
      expect(decryptSecret(ciphertext, KEY)).toBe(pt);
    }
  });

  it("produces a base64 string that is never the plaintext", () => {
    const pt = "sk-or-v1-supersecretkeymaterial-last4=9f2a";
    const ciphertext = encryptSecret(pt, KEY);
    expect(ciphertext).not.toBe(pt);
    expect(ciphertext).toMatch(BASE64);
    // The plaintext (and its tail) must not survive verbatim in the ciphertext.
    expect(ciphertext.includes(pt)).toBe(false);
    expect(ciphertext.includes("9f2a")).toBe(false);
  });

  it("uses a unique nonce per call (same plaintext → distinct ciphertexts)", () => {
    const pt = "same-plaintext-every-time";
    const outputs = new Set<string>();
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const ciphertext = encryptSecret(pt, KEY);
      outputs.add(ciphertext);
      // iv is bytes [1, 13) of the packed blob.
      ivs.add(unpack(ciphertext).subarray(1, 13).toString("hex"));
    }
    expect(outputs.size).toBe(50);
    expect(ivs.size).toBe(50);
  });

  it("packs version 0x01 + iv + tag + ciphertext", () => {
    const pt = "abcdef";
    const packed = unpack(encryptSecret(pt, KEY));
    expect(packed[0]).toBe(0x01);
    expect(packed.length).toBe(HEADER_BYTES + Buffer.byteLength(pt, "utf8"));
    // Non-empty plaintext ⇒ at least one ciphertext byte beyond the header.
    expect(packed.length).toBeGreaterThan(HEADER_BYTES);
  });

  it("fails authentication when the ciphertext body is tampered", () => {
    const packed = unpack(encryptSecret("tamper-me", KEY));
    // Flip a bit in the last byte (inside the ciphertext region).
    packed[packed.length - 1] ^= 0x01;
    const err = catchError(() => decryptSecret(pack(packed), KEY));
    expect(err).toBeInstanceOf(SecretCryptoError);
    expect((err as SecretCryptoError).code).toBe("AUTH_FAILED");
  });

  it("fails authentication when the auth tag is tampered", () => {
    const packed = unpack(encryptSecret("tamper-tag", KEY));
    // Tag lives at bytes [13, 29). Flip one.
    packed[13] ^= 0x01;
    const err = catchError(() => decryptSecret(pack(packed), KEY));
    expect(err).toBeInstanceOf(SecretCryptoError);
    expect((err as SecretCryptoError).code).toBe("AUTH_FAILED");
  });

  it("fails authentication when decrypted with a different valid key", () => {
    const ciphertext = encryptSecret("secret", KEY);
    const err = catchError(() => decryptSecret(ciphertext, KEY2));
    expect(err).toBeInstanceOf(SecretCryptoError);
    expect((err as SecretCryptoError).code).toBe("AUTH_FAILED");
  });

  it("rejects invalid/short keys on encrypt with code INVALID_KEY", () => {
    const badKeys = [
      "", // empty
      "a".repeat(63), // 63 hex chars (31.5 bytes)
      "a".repeat(65), // 65 hex chars
      "z".repeat(64), // 64 chars but not hex
      Buffer.alloc(32).toString("base64"), // base64 of 32 bytes (44 chars)
      "correct horse battery staple!!!!", // 32-char ASCII passphrase, not hex
    ];
    for (const bad of badKeys) {
      const err = catchError(() => encryptSecret("x", bad));
      expect(err, `key ${JSON.stringify(bad)}`).toBeInstanceOf(SecretCryptoError);
      expect((err as SecretCryptoError).code).toBe("INVALID_KEY");
    }
  });

  it("rejects invalid/short keys on decrypt with code INVALID_KEY", () => {
    const valid = encryptSecret("x", KEY);
    const err = catchError(() => decryptSecret(valid, "a".repeat(10)));
    expect(err).toBeInstanceOf(SecretCryptoError);
    expect((err as SecretCryptoError).code).toBe("INVALID_KEY");
  });

  it("rejects malformed payloads with code MALFORMED_PAYLOAD", () => {
    // Too short (< 29 header bytes).
    const tooShort = pack(Buffer.alloc(10));
    // Wrong version byte (0x02) with an otherwise plausible length.
    const wrongVersion = Buffer.alloc(HEADER_BYTES + 4);
    wrongVersion[0] = 0x02;
    const badVersion = pack(wrongVersion);
    // Not valid base64 at all: Node's Buffer.from(_, "base64") silently drops
    // invalid chars rather than throwing, decoding to < HEADER_BYTES bytes, so
    // this still lands in the MALFORMED_PAYLOAD (too-short) branch.
    const nonBase64Junk = "not-valid-base64!!!___###";

    for (const bad of [tooShort, badVersion, nonBase64Junk]) {
      const err = catchError(() => decryptSecret(bad, KEY));
      expect(err).toBeInstanceOf(SecretCryptoError);
      expect((err as SecretCryptoError).code).toBe("MALFORMED_PAYLOAD");
    }
  });

  it("exposes SecretCryptoError as an Error subclass with a name and code", () => {
    const err = catchError(() => encryptSecret("x", "not-a-key"));
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SecretCryptoError);
    expect((err as SecretCryptoError).name).toBe("SecretCryptoError");
    expect((err as SecretCryptoError).code).toBe("INVALID_KEY");
  });
});

// Capture a thrown error without vitest's toThrow (we assert on the typed .code).
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw, but it returned");
}
