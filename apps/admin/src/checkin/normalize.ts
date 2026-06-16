/** Strip wedge suffix noise and surrounding whitespace from scanned payloads. */
export function normalizeScannedInput(raw: string): string {
  return raw.replace(/[\r\n\t]+$/g, "").trim();
}

export const CHECKIN_DUPLICATE_DEBOUNCE_MS = 300;
