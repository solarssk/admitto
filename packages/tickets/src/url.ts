/** Build the public ticket URL for a Mode A token. */
export function buildTicketUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/t/${token}`;
}

/**
 * Extract the raw token from a full Admitto ticket URL.
 * Returns null if the input is not a recognised ticket URL.
 */
export function extractTokenFromUrl(scanned: string): string | null {
  const match = /\/t\/([A-Za-z0-9_-]{40,60})$/.exec(scanned);
  return match?.[1] ?? null;
}

/** Heuristic: true when input looks like a raw base64url internal token (not a URL or agency payload). */
export function looksLikeInternalToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(s);
}
