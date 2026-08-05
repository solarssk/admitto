/**
 * Display helpers for event-day weather temperatures.
 * Storage and APIs stay in Celsius; convert only when formatting for UI.
 */

export type TempUnit = "C" | "F";

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function roundTemp(value: number): number {
  return Math.round(value);
}

/**
 * Staff event-card unit from the operator's IANA timezone (browser zone).
 * `Europe/*` and everything else → °C; Americas-style zones → °F.
 * Locale (e.g. en-US in Poland) is intentionally ignored.
 */
export function tempUnitFromTimeZone(timeZone: string | null | undefined): TempUnit {
  const tz = timeZone?.trim() ?? "";
  if (!tz) return "C";
  if (
    tz.startsWith("America/") ||
    tz.startsWith("US/") ||
    tz.startsWith("Canada/") ||
    tz === "Pacific/Honolulu" ||
    tz === "Pacific/Juneau" ||
    tz === "Pacific/Pago_Pago" ||
    tz === "Pacific/Guam" ||
    tz === "Pacific/Saipan"
  ) {
    return "F";
  }
  return "C";
}

export function formatTempC(celsius: number): string {
  return `${roundTemp(celsius)}°C`;
}

export function formatTempFFromC(celsius: number): string {
  return `${roundTemp(celsiusToFahrenheit(celsius))}°F`;
}

/** Single-unit label for staff event cards. */
export function formatTempForUnit(celsius: number, unit: TempUnit): string {
  return unit === "F" ? formatTempFFromC(celsius) : formatTempC(celsius);
}

/** Short chip text (`18°` / `64°`) without the unit letter. */
export function formatTempChip(celsius: number, unit: TempUnit): string {
  const n = unit === "F" ? roundTemp(celsiusToFahrenheit(celsius)) : roundTemp(celsius);
  return `${n}°`;
}

/** Range for event-card tooltips (`12° to 18°C` / `54° to 64°F`). */
export function formatTempRangeForUnit(
  minC: number | null | undefined,
  maxC: number,
  unit: TempUnit,
): string {
  if (minC == null) return formatTempForUnit(maxC, unit);
  if (unit === "F") {
    return `${roundTemp(celsiusToFahrenheit(minC))}° to ${roundTemp(celsiusToFahrenheit(maxC))}°F`;
  }
  return `${roundTemp(minC)}° to ${roundTemp(maxC)}°C`;
}

/** Public ticket: always both units (`18°C (64°F)`). */
export function formatTempDual(celsius: number): string {
  return `${formatTempC(celsius)} (${formatTempFFromC(celsius)})`;
}

/** Public ticket range: `12-18°C (54-64°F)`. */
export function formatTempRangeDual(minC: number, maxC: number): string {
  const minF = roundTemp(celsiusToFahrenheit(minC));
  const maxF = roundTemp(celsiusToFahrenheit(maxC));
  return `${roundTemp(minC)}-${roundTemp(maxC)}°C (${minF}-${maxF}°F)`;
}
