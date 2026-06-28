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
  _locale = locale ?? undefined;
}

export function getPreferredLocale(): string | undefined {
  return _locale;
}

export interface LocaleOption {
  value: string | null;
  label: string;
  example: string;
}

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
  { value: "en-GB", label: "English (UK)", example: preview("en-GB") },
  { value: "en-US", label: "English (US)", example: preview("en-US") },
  { value: "pl-PL", label: "Polski", example: preview("pl-PL") },
  { value: "de-DE", label: "Deutsch", example: preview("de-DE") },
  { value: "fr-FR", label: "Français", example: preview("fr-FR") },
  { value: "es-ES", label: "Español", example: preview("es-ES") },
  { value: "it-IT", label: "Italiano", example: preview("it-IT") },
  { value: "pt-BR", label: "Português (Brasil)", example: preview("pt-BR") },
  { value: "nl-NL", label: "Nederlands", example: preview("nl-NL") },
  { value: "ru-RU", label: "Русский", example: preview("ru-RU") },
  { value: "uk-UA", label: "Українська", example: preview("uk-UA") },
  { value: "cs-CZ", label: "Čeština", example: preview("cs-CZ") },
  { value: "tr-TR", label: "Türkçe", example: preview("tr-TR") },
  { value: "ja-JP", label: "日本語", example: preview("ja-JP") },
  { value: "zh-CN", label: "中文（简体）", example: preview("zh-CN") },
  { value: "ko-KR", label: "한국어", example: preview("ko-KR") },
];
