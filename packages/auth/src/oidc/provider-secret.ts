import { encryptToString, decryptFromString } from "@admitto/crypto";

/** AES-GCM additional data: an OIDC client secret ciphertext only decrypts as one. */
const CLIENT_SECRET_CONTEXT = "admitto:oidc-client-secret";

export function encryptClientSecret(plaintext: string): string {
  return encryptToString(plaintext, CLIENT_SECRET_CONTEXT);
}

export function decryptClientSecret(secretEnc: string): string {
  return decryptFromString(secretEnc, CLIENT_SECRET_CONTEXT);
}

export function hasClientSecret(secretEnc: string | null | undefined): boolean {
  return typeof secretEnc === "string" && secretEnc.length > 0;
}
