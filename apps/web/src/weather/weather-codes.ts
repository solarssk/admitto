/**
 * WMO Weather interpretation codes (Open-Meteo) → Tabler icon + short English label.
 * https://open-meteo.com/en/docs#weathervariables
 */

export interface WeatherCodeInfo {
  /** Tabler Icons class without the leading `ti ` (e.g. `ti-sun`). */
  icon: string;
  label: string;
}

const DEFAULT_INFO: WeatherCodeInfo = { icon: "ti-cloud", label: "Weather" };

/** Inclusive code ranges → icon + label (first match wins). */
const WEATHER_CODE_ROWS: ReadonlyArray<{
  min: number;
  max: number;
  icon: string;
  label: string;
}> = [
  { min: 0, max: 0, icon: "ti-sun", label: "Clear" },
  { min: 1, max: 1, icon: "ti-sun", label: "Mainly clear" },
  { min: 2, max: 2, icon: "ti-cloud", label: "Partly cloudy" },
  { min: 3, max: 3, icon: "ti-cloud", label: "Overcast" },
  { min: 45, max: 48, icon: "ti-mist", label: "Fog" },
  { min: 51, max: 57, icon: "ti-cloud-drizzle", label: "Drizzle" },
  { min: 61, max: 67, icon: "ti-cloud-rain", label: "Rain" },
  { min: 71, max: 77, icon: "ti-snowflake", label: "Snow" },
  { min: 80, max: 82, icon: "ti-cloud-rain", label: "Rain showers" },
  { min: 85, max: 86, icon: "ti-snowflake", label: "Snow showers" },
  { min: 95, max: 99, icon: "ti-cloud-storm", label: "Thunderstorm" },
];

export function weatherCodeInfo(code: number | null | undefined): WeatherCodeInfo {
  if (code == null || !Number.isFinite(code)) return DEFAULT_INFO;
  const c = Math.trunc(code);
  for (const row of WEATHER_CODE_ROWS) {
    if (c >= row.min && c <= row.max) return { icon: row.icon, label: row.label };
  }
  return DEFAULT_INFO;
}
