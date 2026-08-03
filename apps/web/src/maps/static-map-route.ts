import type { ResolveEventStaticMapResult } from "./event-static-map-service.js";
import {
  STATIC_MAP_PLACEHOLDER_MAX_AGE_SEC,
  STATIC_MAP_SUCCESS_MAX_AGE_SEC,
} from "./event-static-map-service.js";

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

/** HTTP status for a failed static-map resolve (missing event, no pin, maps disabled). */
export function staticMapFailureStatus(
  reason: Extract<ResolveEventStaticMapResult, { ok: false }>["reason"],
): 404 {
  switch (reason) {
    case "disabled":
    case "not_found":
    case "no_coordinates":
      return 404;
  }
}

/** Cache-Control for `/m/` — placeholders must not stick in proxies for a day. */
export function staticMapCacheControl(placeholder: boolean | undefined): string {
  const maxAge = placeholder ? STATIC_MAP_PLACEHOLDER_MAX_AGE_SEC : STATIC_MAP_SUCCESS_MAX_AGE_SEC;
  return `public, max-age=${maxAge}`;
}
