/**
 * Public weather summary shapes attached to event list DTOs and ticket SSR (ADR 0040).
 */

export type WeatherSummaryStatus = "ok" | "too_far" | "unavailable";

export interface DayForecast {
  date: string;
  weather_code: number;
  temp_max_c: number;
  temp_min_c: number;
}

/** Serialised onto EventDto / ticket HTML. */
export interface WeatherSummaryDto {
  status: WeatherSummaryStatus;
  /** Daytime high (°C) when status is ok. */
  temp_c?: number;
  temp_min_c?: number;
  weather_code?: number;
  /**
   * Days until the event day enters the provider forecast window (status too_far).
   * Not the horizon length - see {@link horizon_days}.
   */
  opens_in_days?: number;
  /** Provider forecast horizon in days (inclusive of today), e.g. 9 metno / 16 openmeteo. */
  horizon_days?: number;
  attribution?: string;
  attribution_url?: string;
}
