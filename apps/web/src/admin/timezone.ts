import { z } from "zod";
import { normalizeTimeZone } from "@admitto/shared/timezones";

function resolveCanonicalTimeZone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Validate IANA timezone — accepts Intl-valid aliases; rejects offset strings like +05:30. */
export function isValidIanaTimezone(tz: string): boolean {
  const preferred = normalizeTimeZone(tz);
  if (preferred === "UTC") return true;

  const canonical = resolveCanonicalTimeZone(tz);
  if (!canonical) return false;

  // Offset identifiers (+05:30) pass Intl but are not canonical IANA zones.
  if (/^[+-]/.test(canonical)) return false;

  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone").includes(canonical) || preferred !== null;
  }

  return !/^GMT/i.test(canonical);
}

/** Best-effort parse of a client-supplied IANA zone (form field / query `tz`). Null when
 * missing or invalid - never blocks the request. */
export function parseOptionalClientTimezone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !isValidIanaTimezone(trimmed)) return null;
  return normalizeTimeZone(trimmed) ?? trimmed;
}

export const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: "Invalid IANA timezone" })
  .transform((timeZone) => normalizeTimeZone(timeZone) ?? timeZone);
