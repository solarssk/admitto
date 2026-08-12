import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionKey } from "./key.js";

export type EncryptedData = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

const CURRENT_KEY_VERSION = 1;
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;

export type CryptoErrorCode = "decryption_failed";

/** Thrown when ciphertext fails to decrypt/authenticate - wrong key or corrupted/tampered
 * data. Callers can branch on `code` without depending on Node's raw AES-GCM error text. */
export class CryptoDecryptionError extends Error {
  readonly code: CryptoErrorCode;

  constructor(message: string) {
    super(message);
    this.name = "CryptoDecryptionError";
    this.code = "decryption_failed";
  }
}

function assertEncryptedPayload(payload: EncryptedData): void {
  if (typeof payload.ciphertext !== "string") {
    throw new TypeError("Invalid encrypted payload: missing ciphertext");
  }
  if (typeof payload.iv !== "string" || typeof payload.authTag !== "string") {
    throw new TypeError("Invalid encrypted payload: missing iv or authTag");
  }
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  if (iv.length !== GCM_IV_BYTES) {
    throw new Error(`Invalid encrypted payload: iv must be ${GCM_IV_BYTES} bytes`);
  }
  if (authTag.length !== GCM_AUTH_TAG_BYTES) {
    throw new Error(`Invalid encrypted payload: authTag must be ${GCM_AUTH_TAG_BYTES} bytes`);
  }
}

export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decrypt(payload: EncryptedData): string {
  assertEncryptedPayload(payload);
  if (payload.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `Unsupported key version: ${payload.keyVersion}. Current supported version: ${CURRENT_KEY_VERSION}.`,
    );
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_AUTH_TAG_BYTES });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Node's raw message here is "Unsupported state or unable to authenticate data" - true
    // for both a wrong/rotated key and tampered ciphertext, and not meaningful to a caller.
    throw new CryptoDecryptionError(
      "Ciphertext could not be decrypted or authenticated. The key may not match the one used to encrypt it, or the stored value is corrupted.",
    );
  }
}

export function encryptToString(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

export function decryptFromString(s: string): string {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid encrypted payload: expected JSON object");
    }
    return decrypt(parsed as EncryptedData);
  } catch (err) {
    // decrypt() already throws CryptoDecryptionError for AES-GCM failures - pass it through
    // unchanged. Everything else here (invalid JSON, wrong shape, unsupported keyVersion) is
    // also "this stored ciphertext cannot be read back", so normalize it the same way instead
    // of leaking a JSON SyntaxError / plain Error past callers that branch on the typed error.
    if (err instanceof CryptoDecryptionError) throw err;
    throw new CryptoDecryptionError(
      "Stored ciphertext is malformed or in an unsupported format and cannot be decrypted.",
    );
  }
}
