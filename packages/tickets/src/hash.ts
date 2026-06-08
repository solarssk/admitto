import { createHash } from "node:crypto";

/** SHA-256 hex digest of a token. Only the hash is persisted — never the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
