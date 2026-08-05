/** Short English labels / Tabler icons for WMO-ish weather codes (mirrors apps/web weather-codes). */

const DEFAULT_LABEL = "Weather";
const DEFAULT_ICON = "ti ti-cloud";

const WEATHER_LABEL_ROWS: ReadonlyArray<{ min: number; max: number; label: string }> = [
  { min: 0, max: 0, label: "Clear" },
  { min: 1, max: 1, label: "Mainly clear" },
  { min: 2, max: 2, label: "Partly cloudy" },
  { min: 3, max: 3, label: "Overcast" },
  { min: 45, max: 48, label: "Fog" },
  { min: 51, max: 57, label: "Drizzle" },
  { min: 61, max: 67, label: "Rain" },
  { min: 71, max: 77, label: "Snow" },
  { min: 80, max: 82, label: "Rain showers" },
  { min: 85, max: 86, label: "Snow showers" },
  { min: 95, max: 99, label: "Thunderstorm" },
];

const WEATHER_ICON_ROWS: ReadonlyArray<{ min: number; max: number; icon: string }> = [
  { min: 0, max: 1, icon: "ti ti-sun" },
  { min: 2, max: 3, icon: "ti ti-cloud" },
  { min: 45, max: 48, icon: "ti ti-mist" },
  { min: 51, max: 57, icon: "ti ti-cloud-drizzle" },
  { min: 61, max: 67, icon: "ti ti-cloud-rain" },
  { min: 71, max: 77, icon: "ti ti-snowflake" },
  { min: 80, max: 82, icon: "ti ti-cloud-rain" },
  { min: 85, max: 86, icon: "ti ti-snowflake" },
  { min: 95, max: 99, icon: "ti ti-cloud-storm" },
];

function truncCode(code: number | null | undefined): number | null {
  if (code == null || !Number.isFinite(code)) return null;
  return Math.trunc(code);
}

export function weatherConditionLabel(code: number | null | undefined): string {
  const c = truncCode(code);
  if (c == null) return DEFAULT_LABEL;
  for (const row of WEATHER_LABEL_ROWS) {
    if (c >= row.min && c <= row.max) return row.label;
  }
  return DEFAULT_LABEL;
}

/** Map Open-Meteo WMO weather_code → Tabler icon class (mirrors server weather-codes). */
export function weatherIconClass(code: number | null | undefined): string {
  const c = truncCode(code);
  if (c == null) return DEFAULT_ICON;
  for (const row of WEATHER_ICON_ROWS) {
    if (c >= row.min && c <= row.max) return row.icon;
  }
  return DEFAULT_ICON;
}
