# @admitto/crypto

AES-256-GCM encryption for secrets and ticket tokens at rest (ADR 0006). Small, dependency-free utility used across the server packages (`@admitto/auth`, `@admitto/tickets`, `@admitto/mailer-config`, `@admitto/mail-delivery`, `@admitto/notifications`, `@admitto/wallet`, `@admitto/import`) and `apps/web`.

## Configuration

`ENCRYPTION_KEY` must be set in the environment - a **32-byte** value, base64-encoded (typically `openssl rand -base64 32`). Missing or wrong-length keys fail fast at first use.

```ts
import { encrypt, decrypt, encryptToString, decryptFromString } from "@admitto/crypto";

const payload = encrypt("client-secret");
const plain = decrypt(payload);
```

`encryptToString` / `decryptFromString` store `{ ciphertext, iv, authTag, keyVersion }` (base64 strings; 12-byte `iv`, 16-byte `authTag`, `keyVersion` `1` or `2`) as a single JSON string. It is used for `Attendee.token_enc`, IdP `client_secret`, TOTP secrets, mail provider credentials, wallet API keys, IMAP bounce-ingest passwords, the weather API key and the notification webhook URL.

## Errors

Both functions take an optional `context` string. With one, the value is written as `keyVersion` `2` and the context is authenticated as AES-GCM additional data (not stored), so a ciphertext moved into a column with another purpose does not decrypt; TOTP secrets, IdP client secrets, mail credentials, event wallet API keys, the IMAP bounce password and the notification webhook URL use it (`SECRET_CONTEXTS` holds the per-column strings; `rebindToContext` upgrades a stored legacy value, used by `npm run db:rebind-secret-contexts`). Without one, `keyVersion` `1` is written. Version `1` values decrypt with or without a context, so existing rows keep working, but a build older than this change cannot read version `2` values (no rollback for those rows).

`decrypt` throws `CryptoDecryptionError` (`err.code === "decryption_failed"`) when the key does not match or the ciphertext was altered. `decryptFromString` throws the same error for malformed JSON, a wrong shape or an unsupported `keyVersion`, so callers can branch on one type. A structurally invalid payload passed straight to `decrypt` throws `TypeError` / `Error` instead. The key is read from `ENCRYPTION_KEY` once per process and cached, so a changed key needs a restart. `getEncryptionKey()` and the `EncryptedData` / `CryptoErrorCode` types are exported too.

## Token helper

`generateToken()` - 256-bit CSPRNG, base64url (about 43 characters) - the shared primitive for internal ticket tokens, session cookies and Mode B `public_ref` values; unrelated to AES payloads.

## Tests

```bash
npm test -w @admitto/crypto
```

Vitest sets a fixed 32-byte test key via `vitest.config.ts`; do not use that value in production.
