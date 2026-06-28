import { z } from "zod";

/** Validate IANA timezone — rejects offset aliases like +05:30 when canonical list is available. */
export function isValidIanaTimezone(tz: string): boolean {
  if (tz === "UTC") return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    return false;
  }
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone").includes(tz);
  }
  return !/^[+-]/.test(tz) && !/^GMT/i.test(tz);
}

export const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: "Invalid IANA timezone" });
