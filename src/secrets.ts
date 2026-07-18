import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level secrets encryption (design-delta §2.10).
 *
 * The OpenRouter API key and the Gloo client secret are encrypted before they
 * are stored in Postgres. `database-lib` owns this primitive so API and DBOS
 * share the exact same format. Display-safe fragments (`keyLast4`, `clientId`)
 * are stored plaintext elsewhere and are not this module's concern.
 *
 * Algorithm: AES-256-GCM with a fresh random 12-byte nonce per value. The key
 * is a 32-byte value supplied as a 64-character hex string (typically
 * `process.env.SECRETS_ENCRYPTION_KEY`, `openssl rand -hex 32`, distinct per
 * environment). Callers pass the key explicitly — this module never reads env.
 *
 * Wire format of the returned/stored string (a single opaque base64 token, so it
 * fits a plain Postgres text column):
 *
 *     base64( VERSION(1) | iv(12) | authTag(16) | ciphertext(N) )
 *
 * The fixed-length 29-byte header lets decrypt slice deterministically. The
 * 1-byte version prefix future-proofs key rotation / algorithm changes.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // NIST-recommended GCM nonce length
const TAG_BYTES = 16; // AES-GCM auth tag
const VERSION = 0x01;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES; // 29
const KEY_HEX = /^[0-9a-fA-F]{64}$/;

/** Discriminates the failure modes of {@link encryptSecret}/{@link decryptSecret}. */
export type SecretCryptoErrorCode =
  | "INVALID_KEY"
  | "MALFORMED_PAYLOAD"
  | "AUTH_FAILED";

/**
 * Thrown by the secrets primitive. Carries a machine-readable {@link code} so
 * callers can distinguish a misconfigured key from a tampered/undecryptable
 * value without string-matching messages.
 */
export class SecretCryptoError extends Error {
  readonly code: SecretCryptoErrorCode;

  constructor(
    code: SecretCryptoErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SecretCryptoError";
    this.code = code;
  }
}

/**
 * Validate the hex key and return the raw 32-byte buffer.
 *
 * The regex check runs BEFORE `Buffer.from(_, "hex")` because the latter
 * silently truncates at the first non-hex nibble (e.g. `"zz"` → empty buffer),
 * so a post-decode length check alone would accept malformed keys.
 */
function parseKey(key: string): Buffer {
  if (typeof key !== "string" || !KEY_HEX.test(key)) {
    throw new SecretCryptoError(
      "INVALID_KEY",
      "encryption key must be a 64-character hex string (32 bytes); " +
        "generate one with `openssl rand -hex 32`",
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a UTF-8 secret. Returns the packed base64 string to store verbatim in
 * a Postgres text column. A fresh random nonce is used per call, so encrypting
 * the same plaintext twice yields different outputs.
 *
 * @throws {SecretCryptoError} `INVALID_KEY` if `key` is not a 64-char hex string.
 */
export function encryptSecret(plaintext: string, key: string): string {
  const keyBuf = parseKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([Buffer.from([VERSION]), iv, authTag, ciphertext]);
  return packed.toString("base64");
}

/**
 * Decrypt a value produced by {@link encryptSecret}, using the same key.
 *
 * @throws {SecretCryptoError}
 *  - `INVALID_KEY` if `key` is not a 64-char hex string;
 *  - `MALFORMED_PAYLOAD` if `payload` isn't the expected packed shape/version;
 *  - `AUTH_FAILED` if the auth tag doesn't verify (wrong key or tampered bytes).
 */
export function decryptSecret(payload: string, key: string): string {
  const keyBuf = parseKey(key);

  const packed = Buffer.from(payload, "base64");
  if (packed.length < HEADER_BYTES) {
    throw new SecretCryptoError(
      "MALFORMED_PAYLOAD",
      `ciphertext is too short to be a valid secret payload (need >= ${HEADER_BYTES} bytes)`,
    );
  }
  // Reject an unexpected version with a constant-time-ish equality (single byte).
  if (packed[0] !== VERSION) {
    throw new SecretCryptoError(
      "MALFORMED_PAYLOAD",
      `unsupported secret payload version ${packed[0]} (expected ${VERSION})`,
    );
  }

  const iv = packed.subarray(1, 1 + IV_BYTES);
  const authTag = packed.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = packed.subarray(HEADER_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    // decipher.final() throws when the GCM tag doesn't verify — a wrong key and a
    // tampered ciphertext are indistinguishable, and both must fail loudly.
    throw new SecretCryptoError(
      "AUTH_FAILED",
      "failed to authenticate secret: wrong key or tampered ciphertext",
      { cause: err },
    );
  }
}
