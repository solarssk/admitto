/**
 * Public weather summary shapes attached to event list DTOs and ticket SSR (ADR 0040).
 */

/**
 * - `ok`: forecast for the event day (today or ahead, inside the provider horizon).
 * - `too_far`: the event day is still beyond the provider horizon.
 * - `unavailable`: the provider failed or is not configured for a day that should have a forecast.
 * - `past`: the event day is over. Not an error, and nothing to show: MET Norway serves forecasts
 *   only and Open-Meteo's forecast window starts today, so neither can say what an ended day was like.
 */
export type WeatherSummaryStatus = "ok" | "too_far" | "unavailable" | "past";

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
