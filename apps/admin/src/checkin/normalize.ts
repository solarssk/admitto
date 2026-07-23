/** Extract Admitto ticket token from a full ticket URL (trailing slash / query tolerated). */
function extractTicketTokenFromUrl(input: string): string | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
  const match = /\/t\/([A-Za-z0-9_-]{40,60})(?:\/)?(?:[?#].*)?$/.exec(input); // NOSONAR — bounded {40,60} capture, no nested/overlapping quantifiers; already reviewed for the equivalent eslint security/detect-unsafe-regex rule above
  return match?.[1] ?? null;
}

/** Strip wedge suffix noise, extract ticket token from URLs, trim whitespace. */
export function normalizeScannedInput(raw: string): string {
  const trimmed = raw.replace(/[\r\n\t]+$/g, "").trim();
  return extractTicketTokenFromUrl(trimmed) ?? trimmed;
}

/** Debounce identical payloads (camera + wedge). */
export const CHECKIN_DUPLICATE_DEBOUNCE_MS = 2500;
