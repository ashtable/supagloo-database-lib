---
name: secret-crypto-helpers
description: Task #6 db-lib encryptSecret/decryptSecret contract — AES-256-GCM wire format, 64-hex key encoding, SecretCryptoError codes
metadata:
  type: decision
---

Task #6 (2026-07-17) added the application-level secrets primitive
(design-delta §2.10) to `/Users/ash/code/supagloo-database-lib/src/secrets.ts`,
exported from `src/index.ts`. Consumers (tasks 12 = provider connect, 43 = key
rotation) MUST use this exact contract — encrypting/decrypting the OpenRouter API
key (`OpenRouterConnection.apiKeyCiphertext`) and Gloo client secret
(`GlooConnection.clientSecretCiphertext`), both plain Postgres `text`.

**Public API (all synchronous):**
```ts
encryptSecret(plaintext: string, key: string): string
decryptSecret(payload:   string, key: string): string
class SecretCryptoError extends Error { readonly code: SecretCryptoErrorCode }
type SecretCryptoErrorCode = "INVALID_KEY" | "MALFORMED_PAYLOAD" | "AUTH_FAILED"
```

- **Sync, and the key is an explicit parameter** — NOT read from `process.env`
  inside the helper. **Why:** no I/O to await; mirrors the repo convention that
  runtime code takes config as params (`createPrismaClient({ connectionString })`),
  keeping the primitive pure/testable. API & DBOS read
  `process.env.SECRETS_ENCRYPTION_KEY` at their edge and pass it in. Only the
  **e2e test** reads the env var itself (dev fallback), exactly like `schema.e2e.ts`
  reads `DATABASE_URL`.

- **Key encoding = 64-char hex → 32 bytes** (`openssl rand -hex 32`). Chosen over
  base64 for one canonical form (no url-safe/padding variants), trivially
  length-checkable. Validated with `/^[0-9a-fA-F]{64}$/` **before**
  `Buffer.from(_, "hex")` — the latter silently truncates on non-hex nibbles, so a
  post-decode length check alone would accept junk. Bad key ⇒ `INVALID_KEY`.

- **Wire format (the stored string):**
  `base64( VERSION(0x01, 1B) | iv(12B) | authTag(16B) | ciphertext(N) )`.
  Single opaque base64 token (fits a text column). 29-byte fixed header ⇒ decrypt
  slices deterministically: iv `[1,13)`, tag `[13,29)`, ct `[29,)`. Fresh
  `randomBytes(12)` nonce per call (NIST GCM size) ⇒ same plaintext → different
  output every time. Empty plaintext is allowed and round-trips. **UTF-8** plaintext.

- **1-byte version prefix = future-proofing for rotation** (task 43): a v2 format
  can be introduced unambiguously; `decryptSecret` throws `MALFORMED_PAYLOAD` on any
  version ≠ 0x01. The version byte is outside the GCM tag (flipping it → clean
  version-mismatch rejection; no plaintext leaks either way).

- **No AAD** — the spec wants a generic primitive shared verbatim by API/DBOS;
  binding ciphertext to per-row context (userId/field) via AAD would force callers
  to thread matching AAD through decrypt. Left as possible future hardening.

- **Failure modes:** `INVALID_KEY` (bad key, checked first on both fns);
  `MALFORMED_PAYLOAD` (base64 too short < 29B, or wrong version byte); `AUTH_FAILED`
  (GCM tag mismatch from `decipher.final()` — **wrong key and tampered ciphertext
  are indistinguishable and both throw**, never return garbage).

**Tests:** `src/secrets.test.ts` (11 unit: round-trip incl. empty/unicode, nonce
uniqueness ×50, format-lock, tamper-body/tamper-tag/wrong-key → AUTH_FAILED,
invalid-key on encrypt+decrypt, malformed payload). `tests/e2e/secrets.e2e.ts` (3:
persist ciphertext into real OpenRouter + Gloo rows, read back, assert stored ≠
plaintext incl. a raw-SQL substring check, decrypt back; key-bound wrong-key check).
E2e reuses the `schema.e2e.ts` infra (DATABASE_URL fallback, `migrate deploy`,
`RUN`-namespaced users, cascade cleanup). No new npm dep — `node:crypto` only.
`.env.example` documents `SECRETS_ENCRYPTION_KEY` (with a dev-only placeholder).
