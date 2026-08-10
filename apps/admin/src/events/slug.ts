/** Stable short base36 suffix from title text (for non-ASCII-only fallbacks). */
function titleFingerprint(title: string): string {
  let hash = 2166136261;
  for (let i = 0; i < title.length; i++) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Derive a URL-safe event slug from a title (lowercase, dashes, max length).
 * Titles with no ASCII letters/digits (e.g. Cyrillic-only) strip to empty under the
 * URL alphabet, so return a stable `event-<fingerprint>` fallback instead of "".
 */
export function slugFromTitle(title: string, maxLength = 60): string {
  const trimmed = title.trim();
  if (!trimmed) return "";

  const fromTitle = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, maxLength)
    .replace(/^-|-$/g, "");

  if (fromTitle) return fromTitle;

  return `event-${titleFingerprint(trimmed)}`.slice(0, maxLength);
}
