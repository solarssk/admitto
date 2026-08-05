/**
 * WMO Weather interpretation codes (Open-Meteo) → Tabler icon + short English label.
 * https://open-meteo.com/en/docs#weathervariables
 */

export interface WeatherCodeInfo {
  /** Tabler Icons class without the leading `ti ` (e.g. `ti-sun`). */
  icon: string;
  label: string;
}

export function weatherCodeInfo(code: number | null | undefined): WeatherCodeInfo {
  if (code == null || !Number.isFinite(code)) {
    return { icon: "ti-cloud", label: "Weather" };
  }
  const c = Math.trunc(code);
  if (c === 0) return { icon: "ti-sun", label: "Clear" };
  if (c === 1) return { icon: "ti-sun", label: "Mainly clear" };
  if (c === 2) return { icon: "ti-cloud", label: "Partly cloudy" };
  if (c === 3) return { icon: "ti-cloud", label: "Overcast" };
  if (c === 45 || c === 48) return { icon: "ti-mist", label: "Fog" };
  if (c >= 51 && c <= 57) return { icon: "ti-cloud-drizzle", label: "Drizzle" };
  if (c >= 61 && c <= 67) return { icon: "ti-cloud-rain", label: "Rain" };
  if (c >= 71 && c <= 77) return { icon: "ti-snowflake", label: "Snow" };
  if (c >= 80 && c <= 82) return { icon: "ti-cloud-rain", label: "Rain showers" };
  if (c === 85 || c === 86) return { icon: "ti-snowflake", label: "Snow showers" };
  if (c >= 95 && c <= 99) return { icon: "ti-cloud-storm", label: "Thunderstorm" };
  return { icon: "ti-cloud", label: "Weather" };
}
