/** Build the public ticket URL for a Mode A token. */
export function buildTicketUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/t/${token}`;
}

/**
 * Extract the raw token from a full Admitto ticket URL.
 * Returns null if the input is not a recognised ticket URL.
 */
export function extractTokenFromUrl(scanned: string): string | null {
  const trimmed = scanned.trim();
  const suffixStart = trimmed.search(/[?#]/);
  const urlPath = suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart);
  const marker = "/t/";
  const start = urlPath.lastIndexOf(marker);
  if (start === -1) return null;

  const path = urlPath.slice(start + marker.length);
  const token = path.endsWith("/") ? path.slice(0, -1) : path;
  return looksLikeInternalToken(token) ? token : null;
}

/** Heuristic: true when input looks like a raw base64url internal token (not a URL or agency payload). */
export function looksLikeInternalToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(s);
}
