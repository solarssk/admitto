# @admitto/crypto

AES-256-GCM encryption for secrets and ticket tokens at rest (ADR 0006). Small, dependency-free utility used by `@admitto/auth`, `@admitto/tickets`, and `@admitto/mailer-config`.

## Configuration

`ENCRYPTION_KEY` must be set in the environment — a **32-byte** value, base64-encoded (typically `openssl rand -base64 32`). Missing or wrong-length keys fail fast at first use.

```ts
import { encrypt, decrypt, encryptToString, decryptFromString } from "@admitto/crypto";

const payload = encrypt("client-secret");
const plain = decrypt(payload);
```

`encryptToString` / `decryptFromString` store `{ ciphertext, iv, tag, keyVersion }` as a single JSON string (used for `Attendee.token_enc`, IdP `client_secret`, etc.).

## Token helper

`generateToken()` — 256-bit CSPRNG, base64url — for opaque identifiers unrelated to AES payloads.

## Tests

```bash
npm test -w @admitto/crypto
```

Vitest sets a fixed 32-byte test key via `vitest.config.ts`; do not use that value in production.
