/** Curated BCP-47 tags allowed for User.preferred_locale (keep in sync with Account UI). */
export const SUPPORTED_LOCALE_TAGS = [
  "en-GB",
  "en-US",
  "pl-PL",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "nl-NL",
  "ru-RU",
  "ja-JP",
  "zh-CN",
  "ko-KR",
  "cs-CZ",
  "uk-UA",
  "tr-TR",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALE_TAGS)[number];

const TAG_SET = new Set<string>(SUPPORTED_LOCALE_TAGS);

export function isSupportedLocale(value: string): value is SupportedLocale {
  return TAG_SET.has(value);
}

/**
 * Normalize DB/API locale values: null stays null; invalid or empty → null.
 * Defense-in-depth when reading outside PATCH validation (direct DB edits, drift).
 */
export function sanitizePreferredLocale(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || !isSupportedLocale(trimmed)) return null;
  return trimmed;
}
