/** Explicit account-level display choice for time inputs. */
export const PREFERRED_TIME_FORMATS = ["12h", "24h"] as const;

export type PreferredTimeFormat = (typeof PREFERRED_TIME_FORMATS)[number];

export function isPreferredTimeFormat(value: unknown): value is PreferredTimeFormat {
  return typeof value === "string" && PREFERRED_TIME_FORMATS.includes(value as PreferredTimeFormat);
}

/** Legacy or manually edited values must not affect the staff UI. */
export function sanitizePreferredTimeFormat(value: unknown): PreferredTimeFormat | null {
  return isPreferredTimeFormat(value) ? value : null;
}
