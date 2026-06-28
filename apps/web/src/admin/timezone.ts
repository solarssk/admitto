import { z } from "zod";

function resolveCanonicalTimeZone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Validate IANA timezone — accepts Intl-valid aliases; rejects offset strings like +05:30. */
export function isValidIanaTimezone(tz: string): boolean {
  if (tz === "UTC") return true;

  const canonical = resolveCanonicalTimeZone(tz);
  if (!canonical) return false;

  // Offset identifiers (+05:30) pass Intl but are not canonical IANA zones.
  if (/^[+-]/.test(canonical)) return false;

  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone").includes(canonical);
  }

  return !/^GMT/i.test(canonical);
}

export const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: "Invalid IANA timezone" });
