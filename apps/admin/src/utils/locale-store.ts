import { isSupportedLocale, SUPPORTED_LOCALE_TAGS } from "@admitto/shared";

/**
 * Module-level locale preference for date formatting.
 *
 * Set on auth bootstrap and AccountPage load/save. Components using formatEventDate /
 * formatEventDateTime / formatUtcDateTime pick it up without prop-drilling.
 *
 * null / undefined → browser default (toLocaleDateString(undefined, …))
 */

let _locale: string | undefined = undefined;

export function setPreferredLocale(locale: string | null | undefined): void {
  if (locale == null || locale === "") {
    _locale = undefined;
    return;
  }
  _locale = isSupportedLocale(locale) ? locale : undefined;
}

export function getPreferredLocale(): string | undefined {
  return _locale;
}

export interface LocaleOption {
  value: string | null;
  label: string;
  example: string;
}

const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALE_TAGS)[number], string> = {
  "en-GB": "English (UK)",
  "en-US": "English (US)",
  "pl-PL": "Polski",
  "de-DE": "Deutsch",
  "fr-FR": "Français",
  "es-ES": "Español",
  "it-IT": "Italiano",
  "pt-BR": "Português (Brasil)",
  "nl-NL": "Nederlands",
  "ru-RU": "Русский",
  "ja-JP": "日本語",
  "zh-CN": "中文（简体）",
  "ko-KR": "한국어",
  "cs-CZ": "Čeština",
  "uk-UA": "Українська",
  "tr-TR": "Türkçe",
};

const PREVIEW_DATE = new Date("2026-06-28T12:00:00Z");

function preview(locale: string | undefined): string {
  return PREVIEW_DATE.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { value: null, label: "System default (browser)", example: preview(undefined) },
  ...SUPPORTED_LOCALE_TAGS.map((value) => ({
    value,
    label: LOCALE_LABELS[value],
    example: preview(value),
  })),
];
