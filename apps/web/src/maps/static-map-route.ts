import type { ResolveEventStaticMapResult } from "./event-static-map-service.js";

/** Parse `{eventId}.png` from the public `/m/:filename` route. */
export function parseEventIdFromStaticMapFilename(filename: string): string | null {
  if (!filename.endsWith(".png")) return null;
  try {
    const eventId = decodeURIComponent(filename.slice(0, -4));
    return eventId || null;
  } catch {
    return null;
  }
}

/** HTTP status for a failed static-map resolve (404 for missing/disabled, 502 for render). */
export function staticMapFailureStatus(
  reason: Extract<ResolveEventStaticMapResult, { ok: false }>["reason"],
): 404 | 502 {
  return reason === "render_failed" ? 502 : 404;
}
