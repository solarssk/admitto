/** Short English labels for WMO-ish weather codes (mirrors apps/web weather-codes). */
export function weatherConditionLabel(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return "Weather";
  const c = Math.trunc(code);
  if (c === 0) return "Clear";
  if (c === 1) return "Mainly clear";
  if (c === 2) return "Partly cloudy";
  if (c === 3) return "Overcast";
  if (c === 45 || c === 48) return "Fog";
  if (c >= 51 && c <= 57) return "Drizzle";
  if (c >= 61 && c <= 67) return "Rain";
  if (c >= 71 && c <= 77) return "Snow";
  if (c >= 80 && c <= 82) return "Rain showers";
  if (c === 85 || c === 86) return "Snow showers";
  if (c >= 95 && c <= 99) return "Thunderstorm";
  return "Weather";
}

/** Map Open-Meteo WMO weather_code → Tabler icon class (mirrors server weather-codes). */
export function weatherIconClass(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return "ti ti-cloud";
  const c = Math.trunc(code);
  if (c === 0 || c === 1) return "ti ti-sun";
  if (c === 2 || c === 3) return "ti ti-cloud";
  if (c === 45 || c === 48) return "ti ti-mist";
  if (c >= 51 && c <= 57) return "ti ti-cloud-drizzle";
  if (c >= 61 && c <= 67) return "ti ti-cloud-rain";
  if (c >= 71 && c <= 77) return "ti ti-snowflake";
  if (c >= 80 && c <= 82) return "ti ti-cloud-rain";
  if (c === 85 || c === 86) return "ti ti-snowflake";
  if (c >= 95 && c <= 99) return "ti ti-cloud-storm";
  return "ti ti-cloud";
}
