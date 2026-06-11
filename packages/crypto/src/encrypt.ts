import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionKey } from "./key.js";

export type EncryptedData = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

const CURRENT_KEY_VERSION = 1;

export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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
  if (payload.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `Unsupported key version: ${payload.keyVersion}. Current supported version: ${CURRENT_KEY_VERSION}.`,
    );
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptToString(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

export function decryptFromString(s: string): string {
  return decrypt(JSON.parse(s) as EncryptedData);
}
