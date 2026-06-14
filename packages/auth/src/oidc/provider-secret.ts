import { encryptToString, decryptFromString } from "@admitto/crypto";

export function encryptClientSecret(plaintext: string): string {
  return encryptToString(plaintext);
}

export function decryptClientSecret(secretEnc: string): string {
  return decryptFromString(secretEnc);
}

export function hasClientSecret(secretEnc: string | null | undefined): boolean {
  return typeof secretEnc === "string" && secretEnc.length > 0;
}
