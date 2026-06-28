import { z } from "zod";

/** Validate IANA timezone via Intl (no hardcoded list). */
export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: "Invalid IANA timezone" });
