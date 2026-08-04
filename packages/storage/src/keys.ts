/**
 * Soft-parse a public `/uploads/…` URL into a storage key (path under the upload root).
 * Returns null for external URLs, malformed paths, or non-managed layouts.
 * Matches the managed layouts accepted by branding upload URL parsing.
 */

const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const UPLOAD_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|woff2|woff|ttf|otf)$/;

/** True when `key` is a managed branding upload path (org / theme / event layouts). */
export function isManagedUploadKey(key: string): boolean {
  if (!key || key.includes("\\") || key.includes("..") || key.startsWith("/") || key.endsWith("/")) {
    return false;
  }
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;

  if (parts.length === 2) {
    const [orgId, filename] = parts as [string, string];
    return ORG_ID_PATTERN.test(orgId) && UPLOAD_FILENAME_PATTERN.test(filename);
  }
  if (parts.length === 3 && parts[1] === "theme") {
    const [orgId, , filename] = parts as [string, string, string];
    return ORG_ID_PATTERN.test(orgId) && UPLOAD_FILENAME_PATTERN.test(filename);
  }
  if (parts.length === 4 && parts[1] === "events") {
    const [orgId, , eventId, filename] = parts as [string, string, string, string];
    return (
      ORG_ID_PATTERN.test(orgId) &&
      EVENT_ID_PATTERN.test(eventId) &&
      UPLOAD_FILENAME_PATTERN.test(filename)
    );
  }
  return false;
}

/**
 * Map `/uploads/{key}` to `{key}` when the path is a managed upload; otherwise null.
 * Also accepts a bare key (no `/uploads/` prefix) when it already looks managed.
 */
export function tryParseUploadKey(urlOrKey: string): string | null {
  if (typeof urlOrKey !== "string" || !urlOrKey) return null;
  if (urlOrKey.includes("?") || urlOrKey.includes("#") || urlOrKey.includes("\\") || urlOrKey.includes("..")) {
    return null;
  }

  let key = urlOrKey;
  if (key.startsWith("/uploads/")) {
    key = key.slice("/uploads/".length);
  } else if (key.startsWith("uploads/")) {
    key = key.slice("uploads/".length);
  }

  if (!isManagedUploadKey(key)) return null;
  return key;
}

/** Extract managed `/uploads/…` keys mentioned in free-form template text. */
export function extractUploadKeysFromText(text: string): string[] {
  if (!text) return [];
  const keys: string[] = [];
  // Capture path after /uploads/ until whitespace, quote, or HTML/CSS delimiter.
  const re = /\/uploads\/([a-z0-9][a-z0-9_-]{0,63}(?:\/(?:theme|events\/[a-z0-9][a-z0-9_-]{0,127}))?\/[0-9a-f-]{36}\.(?:png|jpg|webp|woff2|woff|ttf|otf))/gi;
  for (const match of text.matchAll(re)) {
    const key = tryParseUploadKey(`/uploads/${match[1]}`);
    if (key) keys.push(key);
  }
  return keys;
}
